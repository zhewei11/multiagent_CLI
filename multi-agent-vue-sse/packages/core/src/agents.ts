import OpenAI from 'openai';
import dotenv from 'dotenv';
import { get_encoding } from '@dqbd/tiktoken';

dotenv.config();
// ---- Env-driven config ----
const CFG = {
  WRITER_MODEL: process.env.WRITER_MODEL ?? 'gpt-4o-mini',
  RESEARCH_MODEL: process.env.RESEARCH_MODEL ?? 'gpt-4o-mini',
  CRITIC_MODEL: process.env.CRITIC_MODEL ?? 'gpt-4o-mini',
  ROUTER_MODEL: process.env.ROUTER_MODEL ?? 'gpt-4o-mini',
  EMBED_MODEL: process.env.EMBED_MODEL ?? 'text-embedding-3-small',

  WRITER_TEMPERATURE: Number(process.env.WRITER_TEMPERATURE ?? '0.7'),
  WRITER_MAX_TOKENS: Number(process.env.WRITER_MAX_TOKENS ?? '1800'),
  RESEARCH_TEMPERATURE: Number(process.env.RESEARCH_TEMPERATURE ?? '0.2'),
  ANALYST_TEMPERATURE: Number(process.env.ANALYST_TEMPERATURE ?? '0.2'),
  CRITIC_TEMPERATURE: Number(process.env.CRITIC_TEMPERATURE ?? '0.3'),

  SEARCH_MAX_RESULTS: Number(process.env.SEARCH_MAX_RESULTS ?? '10'),
  FACTCHECK_CLAIMS: Number(process.env.FACTCHECK_CLAIMS ?? '4'),
  FACTCHECK_PER_CLAIM_SOURCES: Number(process.env.FACTCHECK_PER_CLAIM_SOURCES ?? '6'),

  CACHE_TTL_MS: Number(process.env.CACHE_TTL_MS ?? '600000'),
  NEWS_DAYS: Number(process.env.NEWS_DAYS ?? '7'),
  MIN_EN_SOURCES: Number(process.env.MIN_EN_SOURCES ?? '3'),
  MAX_PER_DOMAIN: Number(process.env.MAX_PER_DOMAIN ?? '2'),
  QUERY_EXPANSION: (process.env.QUERY_EXPANSION ?? '1') !== '0',
  SEARCH_PARALLEL_NEWS: (process.env.SEARCH_PARALLEL_NEWS ?? '1') !== '0',
  MEMORY_PATH: process.env.MEMORY_PATH ?? './memory.jsonl',
};


/* -------------------------------- Types -------------------------------- */
export interface Source { title?: string; url: string; snippet?: string; published?: string }
export interface Fact { statement: string; source: string; evidence?: string; published?: string }
export interface ResearchBundle { id: string; query: string; sources: Source[]; facts: Fact[] }
export interface RouterPlan { useWeb: boolean; topic: 'general' | 'news'; steps: string[]; maxIterations: number }
export interface FactCheckItem { text: string; verdict: 'SUPPORTED' | 'WEAK' | 'NO_EVIDENCE' | 'CONTRADICTED' }
export interface FactCheckReport { claims: FactCheckItem[]; summary?: string }
export interface TokenUsage { prompt: number; completion: number; total: number }

export interface Settings {
  speedMode: 'fast' | 'balanced' | 'thorough';
  lang: 'auto' | 'en' | 'zh-TW' | 'ja' | 'ko';
  useWeb: boolean;
  timeLimitMs?: number | null;
  minEnSources?: number; // default 3
  maxPerDomain?: number; // default 2
  queryExpansion?: boolean; // default true
}

export type Emit = (event: string, payload: any) => void | Promise<void>;

/* ------------------------------ Globals -------------------------------- */
let _openai: OpenAI | null = null;
function getOpenAI(){
  const key = process.env.OPENAI_API_KEY; if (!key) throw new Error('Missing OPENAI_API_KEY');
  return (_openai ??= new OpenAI({ apiKey: key }));
}
const TAVILY_KEY = process.env.TAVILY_API_KEY || '';

// Encoder cache to avoid repeated init cost
const ENCODER = get_encoding('cl100k_base');
process.on('exit', () => { try { ENCODER.free(); } catch {} });

/* ------------------------------ Utilities ------------------------------ */
function hasCJK(s: string){ return /[\u4E00-\u9FFF]/.test(s); }

/** Map settings.lang -> strict guardrail for system prompts */
function langDirective(lang: Settings['lang']){
  switch (lang){
    case 'en':    return 'English ONLY. Do not use any other language.';
    case 'zh-TW': return 'Traditional Chinese (zh-TW) ONLY. Do not use any other language.';
    case 'ja':    return 'Japanese ONLY. Do not use any other language.';
    case 'ko':    return 'Korean ONLY. Do not use any other language.';
    case 'auto':
    default:      return "the same language as the user's question ONLY. Do not use any other language.";
  }
}

function tryParseJSON(s: string): any | null {
  try { return JSON.parse(s); } catch {}
  const obj = s.match(/\{[\s\S]*\}/); if (obj) { try { return JSON.parse(obj[0]); } catch {} }
  return null;
}

class TokenTracker {
  private prompt = 0; private completion = 0;
  addPromptText(txt: string){ this.prompt += this.count(txt); }
  addCompletionText(txt: string){ this.completion += this.count(txt); }
  private count(text: string){ try { return ENCODER.encode(text).length; } catch { return Math.ceil(text.length/4); } }
  usage(): TokenUsage { return { prompt: this.prompt, completion: this.completion, total: this.prompt + this.completion }; }
}

/* ------------------------------ Web Search ----------------------------- */
async function tavilySearch(query: string, params: { search_depth?: 'basic'|'advanced'; max_results?: number } = {}, signal?: AbortSignal): Promise<Source[]>{
  if (!TAVILY_KEY) return [];
  const body = { api_key: TAVILY_KEY, query, include_answer: false, search_depth: params.search_depth ?? 'basic', max_results: params.max_results ?? CFG.SEARCH_MAX_RESULTS };
  try {
    const res = await fetch('https://api.tavily.com/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
    const json = await res.json();
    const items = (json?.results || []) as Array<{title?:string; url:string; content?:string; published?:string}>;
    // de-dup by URL
    const seen = new Set<string>();
    const out: Source[] = [];
    for (const r of items){ if (!seen.has(r.url)){ seen.add(r.url); out.push({ title: r.title || '', url: r.url, snippet: r.content || '', published: r.published }); } }
    return out;
  } catch (e){ console.warn('[tavily] failed:', e); return []; }
}

/* ------------------------------ Agents Core ---------------------------- */
function planRoute(question: string, settings: Settings): RouterPlan {
  return {
    useWeb: settings.useWeb,
    topic: /latest|news|今天|昨日|最新|breaking|剛剛/i.test(question) ? 'news' : 'general',
    steps: ['Researcher', 'Analyst', 'Writer', ...(settings.speedMode !== 'fast' ? ['FactChecker'] : []), 'Critic'],
    maxIterations: settings.speedMode === 'thorough' ? 2 : 1,
  };
}

function expandQueriesHeuristic(q: string): string[]{
  const arr = [q];
  if (hasCJK(q)) arr.push('site:gov 最新 資訊');
  if (!/\b(what|why|how|news|latest)\b/i.test(q)) arr.push(q + ' latest');
  return [...new Set(arr)];
}

/** Extract short facts from sources using LLM; JSON-only */
async function extractFactsLLM(sources: Source[], signal?: AbortSignal): Promise<Fact[]>{
  if (!process.env.OPENAI_API_KEY) return [];
  if (!sources?.length) return [];
  const content = sources.slice(0, 6).map((s, i) => `${i+1}. ${s.title}\n${s.snippet}\n${s.url}`).join('\n\n');
  const sys = 'You are a rigorous research assistant. Extract up to 8 atomic factual statements with {statement, sourceIndex}. Keep statements short. Do not add commentary. Output JSON: {"facts":[{"statement":"...","sourceIndex":1}]}';
  const user = `Source snippets:\n\n${content}`;
  const resp = await getOpenAI().chat.completions.create({ model: CFG.RESEARCH_MODEL, messages: [{ role:'system', content: sys }, { role:'user', content: user }], temperature: CFG.RESEARCH_TEMPERATURE, response_format: { type: 'json_object' } }, { signal });
  const txt = resp.choices[0]?.message?.content?.trim() || '{"facts":[]}';
  const parsed = tryParseJSON(txt) || { facts: [] };
  const facts = (parsed.facts || []).map((it: any) => {
    const s = sources[(it.sourceIndex ?? 1) - 1];
    return { statement: String(it.statement || '').trim(), source: s?.url || '', published: s?.published } as Fact;
  }).filter((f: Fact) => f.statement && f.source);
  // fallback: if nothing parsed, take titles
  return facts.length ? facts : sources.slice(0, 3).map(s => ({ statement: s.title || s.snippet || '(no title)', source: s.url, published: s.published }));
}

/** Stream writer tokens; output language obeys settings.lang */
async function* streamWriterLLM(prompt: string, lang: Settings['lang'], signal?: AbortSignal, opts: { minAnalysisPoints?: number } = {}){
  const target = langDirective(lang);
  const minPts = Math.max(3, Math.min(10, opts.minAnalysisPoints ?? 6));
  const sys = [
    'You are a precise expert writer. Write structured, helpful answers with headings and bullet points when useful.',
    `You MUST write your entire response in ${target}`,
    `Include at least ${minPts} distinct analysis points beyond mere summarization.`,
  ].join('\n');
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role:'system', content: sys },
    { role:'user', content: prompt }
  ];

  // Prefer streaming if available; otherwise chunk the whole text
  const client = getOpenAI();
  const res = await client.chat.completions.create({ model: CFG.WRITER_MODEL, messages, temperature: CFG.WRITER_TEMPERATURE, max_tokens: CFG.WRITER_MAX_TOKENS, stream: true }, { signal }) as any;
  if (typeof res[Symbol.asyncIterator] === 'function'){
    for await (const chunk of res){
      const token = chunk.choices?.[0]?.delta?.content || '';
      if (token) yield token as string;
    }
  } else {
    // non-stream fallback
    const non = await client.chat.completions.create({ model: 'gpt-4o-mini', messages, temperature: 0.3 }, { signal });
    const text = non.choices[0]?.message?.content || '';
    for (let i=0;i<text.length;i+=8){ yield text.slice(i, i+8); }
  }
}

/** JSON-only fact-checker; summary obeys settings.lang */
async function factCheckLLM(answer: string, facts: Fact[], lang: Settings['lang'], signal?: AbortSignal): Promise<FactCheckReport>{
  if (!process.env.OPENAI_API_KEY) return { claims: [] };
  const target = langDirective(lang);
  const sys = [
    'You are a fact-checker. Output **pure JSON** only.',
    'Schema: {"claims":[{"text":"string","verdict":"SUPPORTED|WEAK|NO_EVIDENCE|CONTRADICTED"}],"summary":"string"}',
    `Write the summary in ${target}`,
  ].join('\n');
  const user = [
    'Answer to check:\n' + answer,
    'Facts (may be partial, noisy):\n' + facts.map((f,i)=>`(${i+1}) ${f.statement} [${f.source}]`).join('\n'),
  ].join('\n\n');
  const resp = await getOpenAI().chat.completions.create({ model: CFG.CRITIC_MODEL, messages:[{role:'system',content:sys},{role:'user',content:user}], temperature: CFG.CRITIC_TEMPERATURE, response_format: { type: 'json_object' } }, { signal });
  const raw = resp.choices[0]?.message?.content?.trim() || '{"claims":[]}';
  const parsed = tryParseJSON(raw) || { claims: [] };
  if (!parsed.claims?.length){
    // naive fallback: slice a few sentences
    const candidates = (answer.match(/[^。！？\n\.!?]{6,}[。！？\.!?]/g) || []).slice(0, 3);
    parsed.claims = candidates.map((t: string) => ({ text: t.trim(), verdict: 'NO_EVIDENCE' }));
    parsed.summary = parsed.summary || 'No external facts were available; generated fallback claims.';
  }
  return parsed as FactCheckReport;
}

/* ------------------------------ Orchestrator --------------------------- */
export async function runPipeline(args: { question: string; settings: Settings; emit: Emit; signal?: AbortSignal; }){
  const { question, settings, emit, signal } = args;
  const tracker = new TokenTracker();

  // 1) Router plan
  const plan = planRoute(question, settings);
  await emit('plan', plan);

  // 2) Researcher
  const queries = settings.queryExpansion ? expandQueriesHeuristic(question) : [question];
  let sources: Source[] = [];
  if (settings.useWeb){
    for (const q of queries){
      const part = await tavilySearch(q, { search_depth: 'basic', max_results: 8 }, signal);
      sources.push(...part);
      if (sources.length >= 12) break;
    }
  }
  // domain cap
  if (settings.maxPerDomain && settings.maxPerDomain > 0){
    const byHost: Record<string, number> = {};
    sources = sources.filter(s => {
      try{ const h = new URL(s.url).hostname; byHost[h] = (byHost[h]||0)+1; return byHost[h] <= settings.maxPerDomain!; } catch{ return true; }
    });
  }

  // 3) Analyst → extract facts
  const facts = await extractFactsLLM(sources, signal);
  const researchBundle: ResearchBundle = { id: Math.random().toString(36).slice(2), query: question, sources, facts };
  await emit('research', researchBundle);

  // 4) Writer（串流）；輸出語言由 settings.lang 控制
  const prompt = [
    `Question: ${question}`,
    'Key sources:',
    sources.map((s,i)=>`[${i+1}] ${s.title || s.url} — ${s.url}`).join('\n'),
    'Core facts:',
    facts.map((f,i)=>`- (${i+1}) ${f.statement}`).join('\n')
  ].join('\n\n');
  tracker.addPromptText(prompt);

  let answer = '';
  try {
    const minPts = settings.speedMode === 'thorough' ? 10 : settings.speedMode === 'balanced' ? 8 : 6;
    for await (const token of streamWriterLLM(prompt, settings.lang, signal, { minAnalysisPoints: minPts })){
      answer += token; tracker.addCompletionText(token);
      await emit('writer', { chunk: token });
    }
  } catch (e){ console.warn('[Writer] stream failed; falling back:', e); }

  // 5) FactChecker（可選）
  if (plan.steps.includes('FactChecker')){
    try {
      const report = await factCheckLLM(answer, facts, settings.lang, signal);
      await emit('factcheck', report);
    } catch (e){ console.warn('[FactChecker] failed:', e); }
  }

  // 6) Tokens
  await emit('tokens', tracker.usage());
}