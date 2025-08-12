import 'dotenv/config';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

import { tavily } from '@tavily/core';
import { extract } from '@extractus/article-extractor';
import OpenAI from 'openai';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { encoding_for_model, get_encoding } from '@dqbd/tiktoken';
import type { TiktokenModel } from '@dqbd/tiktoken';


/* ========================== ENV ========================== */
const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;
const TAVILY_API_KEY = process.env.TAVILY_API_KEY!;
if (!OPENAI_API_KEY) throw new Error('Missing OPENAI_API_KEY');
if (!TAVILY_API_KEY) throw new Error('Missing TAVILY_API_KEY');

const WRITER_MODEL   = process.env.WRITER_MODEL   || 'gpt-4o-mini';
const RESEARCH_MODEL = process.env.RESEARCH_MODEL || 'gpt-4o-mini';
const CRITIC_MODEL   = process.env.CRITIC_MODEL   || 'gpt-4o-mini';
const ROUTER_MODEL   = process.env.ROUTER_MODEL   || 'gpt-4o-mini';
const EMBED_MODEL    = process.env.EMBED_MODEL    || 'text-embedding-3-small';

const NEWS_DAYS      = Number(process.env.NEWS_DAYS || '7');
const MEMORY_PATH    = process.env.MEMORY_PATH    || './memory.jsonl';

/* Length & style */
const WRITER_TEMPERATURE   = Number(process.env.WRITER_TEMPERATURE   || '0.7');
const WRITER_MAX_TOKENS    = Number(process.env.WRITER_MAX_TOKENS    || '1800');
const RESEARCH_TEMPERATURE = Number(process.env.RESEARCH_TEMPERATURE || '0.2');
const ANALYST_TEMPERATURE  = Number(process.env.ANALYST_TEMPERATURE  || '0.2');
const CRITIC_TEMPERATURE   = Number(process.env.CRITIC_TEMPERATURE   || '0.3');

/* Search diversity / expansion */
const QUERY_EXPANSION      = process.env.QUERY_EXPANSION === '1';
const MIN_EN_SOURCES       = Number(process.env.MIN_EN_SOURCES || '3');
const MAX_PER_DOMAIN       = Number(process.env.MAX_PER_DOMAIN || '2');
const SEARCH_PARALLEL_NEWS = process.env.SEARCH_PARALLEL_NEWS === '1';

/* FactChecker config */
const FACTCHECK_CLAIMS             = Number(process.env.FACTCHECK_CLAIMS || '4');
const FACTCHECK_PER_CLAIM_SOURCES  = Number(process.env.FACTCHECK_PER_CLAIM_SOURCES || '6');

/* Speed modes: fast | balanced | thorough */
type SpeedMode = 'fast'|'balanced'|'thorough';
let SPEED_MODE: SpeedMode = (process.env.SPEED_MODE as SpeedMode) || 'balanced';

/* Caching */
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || String(10 * 60 * 1000)); // 10 min
const SEARCH_MAX_RESULTS = Number(process.env.SEARCH_MAX_RESULTS || '10');
const FETCH_PAGES_FAST = Number(process.env.FETCH_PAGES_FAST || '3');
const FETCH_PAGES_BAL = Number(process.env.FETCH_PAGES_BAL || '6');
const FETCH_PAGES_THO = Number(process.env.FETCH_PAGES_THO || '8');

/* Time limit (global per run) */
let RUNTIME_LIMIT_MS: number | null = (() => {
  const v = Number(process.env.MAX_TIME_MS || '0');
  return v > 0 ? v : null;
})();

/* ===== Language control ===== */
type LangCode = 'auto'|'en'|'zh-TW'|'ja'|'ko';
let TARGET_LANG: LangCode = (process.env.TARGET_LANG as LangCode) || 'auto';
const RE_CH = /[\u4e00-\u9fff]/;       // zh
const RE_JA = /[\u3040-\u30ff]/;       // ja
const RE_KO = /[\uac00-\ud7af]/;       // ko
function detectLangByText(s: string): Exclude<LangCode,'auto'> {
  if (RE_JA.test(s)) return 'ja';
  if (RE_KO.test(s)) return 'ko';
  if (RE_CH.test(s)) return 'zh-TW';
  return 'en';
}
function resolveTargetLang(text: string): Exclude<LangCode,'auto'> {
  return TARGET_LANG === 'auto' ? detectLangByText(text) : TARGET_LANG;
}
function label(lang: Exclude<LangCode,'auto'>, en: string, zh: string) {
  return lang.startsWith('zh') ? zh : en; // ja/ko 先使用英文標籤，避免直翻不準
}

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const tvly = tavily({ apiKey: TAVILY_API_KEY });

/* ========================== TOKEN TRACKER ========================== */
type ChatMsg = { role: 'system'|'user'|'assistant'; content: string };
class TokenTracker {
  session = { prompt: 0, completion: 0, total: 0 };
  lastRun = { items: [] as Array<{label:string, model:string, prompt:number, completion:number, total:number, source:'usage'|'estimate'}>, totals: { prompt:0, completion:0, total:0 } };
  startRun() { this.lastRun = { items: [], totals: { prompt:0, completion:0, total:0 } }; }
  private encodingName(model: string): TiktokenModel | 'cl100k_base' {
    const m = model.toLowerCase();
    if (m.includes('gpt-4o') || m.includes('gpt-4') || m.includes('gpt-3.5')) return 'cl100k_base';
    return 'cl100k_base';
  }
  private countText(model: string, text: string): number {
    try {
      const enc = encoding_for_model(this.encodingName(model));
      const n = enc.encode(text).length; enc.free(); return n;
    } catch {
      const enc = get_encoding('cl100k_base');
      const n = enc.encode(text).length; enc.free(); return n;
    }
  }
  private countMessages(model: string, messages: ChatMsg[]): number {
    const body = messages.map(m => m.content).join('\n');
    const base = this.countText(model, body);
    const overhead = messages.length * 4 + 2;
    return base + overhead;
  }
  record(label: string, model: string, messages: ChatMsg[], completionText: string | null, usage?: {prompt_tokens?:number, completion_tokens?:number}) {
    let prompt = 0, completion = 0, total = 0, source: 'usage'|'estimate' = 'estimate';
    if (usage && (usage.prompt_tokens || usage.completion_tokens)) {
      prompt = usage.prompt_tokens || 0;
      completion = usage.completion_tokens || 0;
      total = prompt + completion; source = 'usage';
    } else {
      prompt = this.countMessages(model, messages);
      completion = completionText ? this.countText(model, completionText) : 0;
      total = prompt + completion;
    }
    this.lastRun.items.push({ label, model, prompt, completion, total, source });
    this.lastRun.totals.prompt += prompt; this.lastRun.totals.completion += completion; this.lastRun.totals.total += total;
    this.session.prompt += prompt; this.session.completion += completion; this.session.total += total;
  }
}
const TOKENS = new TokenTracker();

/* ========================== SCHEMAS ========================== */
const SourceSchema = z.object({
  title: z.string().optional(),
  url: z.string().url(),
  snippet: z.string().optional(),
  published: z.string().optional(),
  score: z.number().min(0).max(1).optional(),
});
type Source = z.infer<typeof SourceSchema>;

const FactSchema = z.object({
  statement: z.string(),
  source: z.string().url(),
  evidence: z.string().optional(),
  published: z.string().optional(),
});
type Fact = z.infer<typeof FactSchema>;

const ResearchBundleSchema = z.object({
  id: z.string(),
  query: z.string(),
  sources: z.array(SourceSchema).min(0),
  facts: z.array(FactSchema).min(1),
});
type ResearchBundle = z.infer<typeof ResearchBundleSchema>;

const MemoryEntrySchema = z.object({
  id: z.string(),
  ts: z.number(),
  role: z.enum(['user','assistant']),
  text: z.string(),
  facts: z.array(z.string()).optional(),
  entities: z.array(z.string()).optional(),
  keywords: z.array(z.string()).optional(),
  embedding: z.array(z.number()).optional(),
});
type MemoryEntry = z.infer<typeof MemoryEntrySchema>;

const RouterPlanSchema = z.object({
  useWeb: z.boolean().default(true),
  topic: z.enum(['general','news','code','math','hci','research']).default('general'),
  steps: z.array(z.enum(['Researcher','Analyst','Writer','FactChecker','Critic'])).min(1),
  maxIterations: z.number().int().min(1).max(3).default(2),
});
type RouterPlan = z.infer<typeof RouterPlanSchema>;

const CritiqueSchema = z.object({
  verdict: z.enum(['approve','revise']),
  issues: z.array(z.string()).default([]),
  suggestions: z.array(z.string()).default([]),
  inlineEdits: z.string().optional(),
});
type Critique = z.infer<typeof CritiqueSchema>;

const FactCheckItemSchema = z.object({
  text: z.string(),
  verdict: z.enum(['SUPPORTED','WEAK','NO_EVIDENCE','CONTRADICTED']),
  reason: z.string().optional(),
  citations: z.array(z.string().url()).optional(),
});
const FactCheckReportSchema = z.object({
  claims: z.array(FactCheckItemSchema),
  summary: z.string().optional(),
});
type FactCheckReport = z.infer<typeof FactCheckReportSchema>;

/* ========================== UTILS & CACHES ========================== */
function domainOf(url: string) { try { return new URL(url).hostname; } catch { return ''; } }
const TRUST_BONUS: Record<string, number> = {
  'reuters.com': 0.2, 'apnews.com': 0.2, 'bbc.com': 0.17,
  'nytimes.com': 0.15, 'nature.com': 0.2, 'science.org': 0.2,
  'arxiv.org': 0.15, 'gov': 0.12, 'edu': 0.12
};
function tldBonus(host: string) {
  const parts = host.split('.').slice(-2).join('.');
  const tld = host.split('.').slice(-1)[0];
  return (TRUST_BONUS[host] ?? TRUST_BONUS[parts] ?? TRUST_BONUS[tld] ?? 0);
}
function recencyBonus(iso?: string) {
  if (!iso) return 0;
  const dt = new Date(iso);
  if (Number.isNaN(+dt)) return 0;
  const days = (Date.now() - dt.getTime()) / 86400000;
  if (days <= 3) return 0.12;
  if (days <= 7) return 0.08;
  if (days <= 30) return 0.05;
  return 0;
}
function dedupAndScore(items: Source[]) {
  const seen = new Set<string>();
  const out: Source[] = [];
  for (const s of items) {
    const key = (s.title || '') + '|' + domainOf(s.url);
    if (seen.has(key)) continue;
    seen.add(key);
    const host = domainOf(s.url);
    const score = Math.min(1, 0.55 + tldBonus(host) + recencyBonus(s.published));
    out.push({ ...s, score });
  }
  return out.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}
function clip(s: string, n = 200) { return s.length > n ? s.slice(0, n) + '…' : s; }

type Cached<T> = { ts: number, data: T };
const SEARCH_CACHE = new Map<string, Cached<Source[]>>();
const FETCH_CACHE  = new Map<string, Cached<{url:string, title?:string, content:string, published?:string, description?:string}>>();

function fromCache<K,V>(map: Map<K, Cached<V>>, key: K): V | null {
  const v = map.get(key);
  if (!v) return null;
  if (Date.now() - v.ts > CACHE_TTL_MS) { map.delete(key); return null; }
  return v.data;
}
function setCache<K,V>(map: Map<K, Cached<V>>, key: K, data: V) {
  map.set(key, { ts: Date.now(), data });
}

/* Safe embedding getter */
async function getFirstEmbeddingOrNull(text: string): Promise<number[] | null> {
  try {
    const res = await openai.embeddings.create({ model: EMBED_MODEL, input: text });
    const first = res.data?.[0];
    if (first?.embedding && Array.isArray(first.embedding) && first.embedding.length > 0) {
      return first.embedding as number[];
    }
    return null;
  } catch {
    return null;
  }
}

/* Language helpers + query expansion + diversified search */
function hasCJK(s: string) { return /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(s || ''); }
function isEnglishLike(title?: string, snippet?: string, url?: string) {
  const t = (title || '') + ' ' + (snippet || '') + ' ' + (url || '');
  return !hasCJK(t);
}

/* ---------- Time budget helpers ---------- */
function msLeft(deadline: number | null) {
  return deadline === null ? Number.POSITIVE_INFINITY : Math.max(0, deadline - Date.now());
}
function parseDurationToMs(s: string): number | null {
  const m = String(s || '').trim().toLowerCase().match(/^(\d+)(ms|s|m)?$/);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2] || 'ms';
  if (unit === 'ms') return n;
  if (unit === 's') return n * 1000;
  if (unit === 'm') return n * 60 * 1000;
  return null;
}
async function withBudget<T>(
  label: string,
  deadline: number | null,
  ratio: number,
  minMs: number,
  task: () => Promise<T>,
  fallback: () => Promise<T>
): Promise<T> {
  const left = msLeft(deadline);
  if (!Number.isFinite(left)) return task();
  const slice = Math.max(minMs, Math.floor(left * ratio));
  return Promise.race([
    task(),
    (async () => {
      await new Promise(res => setTimeout(res, slice));
      console.warn(`⏱ ${label} timed out after ${slice}ms`);
      return fallback();
    })()
  ]);
}

/* ========================== IO TOOLS (with cache) ========================== */
async function fetchPageTool(url: string) {
  const cached = fromCache(FETCH_CACHE, url);
  if (cached) return cached;
  const data = await extract(url).catch(() => null);
  const out = {
    url,
    title: data?.title,
    content: data?.content?.replace(/\s+/g, ' ').trim().slice(0, 4000) || '',
    published: data?.published || undefined,
    description: data?.description || undefined,
  };
  setCache(FETCH_CACHE, url, out);
  return out;
}
async function webSearchTool(args: {
  query: string; maxResults?: number; topic?: 'general' | 'news'; days?: number; includeRaw?: boolean;
}) {
  const { query, maxResults = SEARCH_MAX_RESULTS, topic = 'general', days = NEWS_DAYS, includeRaw = false } = args;
  const key = `${topic}|${maxResults}|${days}|${query}`;
  const cached = fromCache(SEARCH_CACHE, key);
  if (cached) return cached;

  const params: any = {
    query, max_results: maxResults, topic, include_answer: false, include_raw_content: includeRaw,
  };
  if (topic === 'news') params.days = days;
  const res = await tvly.search(query, params);
  const list = (res.results || []).map((r: any) => ({
    title: r.title, url: r.url, snippet: r.content || r.snippet, published: r.published_date || r.publishedAt,
  })) as Source[];
  setCache(SEARCH_CACHE, key, list);
  return list;
}

/* ========================== SEARCH DIVERSITY HELPERS ========================== */
async function expandQueries(query: string): Promise<string[]> {
  if (!QUERY_EXPANSION) return [query];
  const sys = `Expand the user's query with 3-6 high-quality variations across languages (at least English and the original language). 
Return ONLY JSON: {"queries": ["..."]}. Avoid redundant or overly similar queries.`;
  const messages: ChatMsg[] = [{ role: 'system', content: sys }, { role: 'user', content: query }];
  const res = await openai.chat.completions.create({
    model: RESEARCH_MODEL,
    temperature: 0.3,
    messages,
  });
  TOKENS.record('QueryExpansion', RESEARCH_MODEL, messages, res.choices[0]?.message?.content || '', res.usage as any);
  const text = res.choices[0]?.message?.content || '{}';
  const body = text.match(/```json([\s\S]*?)```/i)?.[1] ?? text;
  try {
    const arr = JSON.parse(body).queries as string[] | undefined;
    if (arr && arr.length) {
      const withOriginal = [query, ...arr];
      const hasEnglish = withOriginal.some(q => !hasCJK(q));
      if (!hasEnglish) withOriginal.push(`(English) ${query}`);
      return Array.from(new Set(withOriginal)).slice(0, 8);
    }
  } catch {}
  if (hasCJK(query)) return [query, `Translate to English and search: ${query}`];
  return [query];
}
async function webSearchMulti(queries: string[], topic: 'general'|'news', maxResults = SEARCH_MAX_RESULTS) {
  const runs: Promise<Source[]>[] = [];
  for (const q of queries) runs.push(webSearchTool({ query: q, maxResults, topic }));
  if (SEARCH_PARALLEL_NEWS && topic === 'general') {
    for (const q of queries) runs.push(webSearchTool({ query: q, maxResults: Math.max(4, Math.floor(maxResults/2)), topic: 'news' }));
  }
  const all = (await Promise.all(runs)).flat();
  return dedupAndScore(all);
}
function diversifySources(sources: Source[], k = 10) {
  const byDomain = new Map<string, number>();
  const picked: Source[] = [];
  let enCount = 0;
  for (const s of sources) {
    const d = domainOf(s.url);
    const used = byDomain.get(d) || 0;
    if (used >= MAX_PER_DOMAIN) continue;
    picked.push(s);
    byDomain.set(d, used + 1);
    if (isEnglishLike(s.title, s.snippet, s.url)) enCount++;
    if (picked.length >= k) break;
  }
  if (enCount < MIN_EN_SOURCES) {
    for (const s of sources) {
      if (picked.includes(s)) continue;
      if (!isEnglishLike(s.title, s.snippet, s.url)) continue;
      const d = domainOf(s.url);
      const used = byDomain.get(d) || 0;
      if (used >= MAX_PER_DOMAIN) continue;
      picked.push(s);
      byDomain.set(d, used + 1);
      enCount++;
      if (enCount >= MIN_EN_SOURCES || picked.length >= k + 3) break;
    }
  }
  return picked.slice(0, k);
}

/* ========================== MEMORY ========================== */
class MemoryManager {
  file: string;
  cache: MemoryEntry[] = [];
  constructor(file: string) {
    this.file = file;
    if (!fs.existsSync(file)) fs.writeFileSync(file, '');
  }
  async load() {
    if (this.cache.length) return this.cache;
    const txt = await fsp.readFile(this.file, 'utf8').catch(() => '');
    const entries: MemoryEntry[] = [];
    for (const line of txt.split('\n')) {
      const s = line.trim();
      if (!s) continue;
      try {
        const ok = MemoryEntrySchema.parse(JSON.parse(s));
        entries.push(ok);
      } catch { /* skip */ }
    }
    this.cache = entries;
    return entries;
  }
  async add(entry: Omit<MemoryEntry, 'id' | 'ts'>) {
    const full: MemoryEntry = { id: nanoid(), ts: Date.now(), ...entry };
    await fsp.appendFile(this.file, JSON.stringify(full) + '\n', 'utf8');
    this.cache.push(full);
    return full;
  }
  async clear() {
    await fsp.writeFile(this.file, '', 'utf8');
    this.cache = [];
  }
  async exportTo(p: string) {
    await fsp.copyFile(this.file, p);
  }
  async retrieve(query: string, k = 6) {
    const all = await this.load();
    if (!all.length) return [];
    const qvec = await getFirstEmbeddingOrNull(query);
    function cosine(a: number[], b: number[]) {
      let dot = 0, na = 0, nb = 0;
      const len = Math.min(a.length, b.length);
      for (let i = 0; i < len; i++) { dot += a[i] * b[i]; na += a[i] ** 2; nb += b[i] ** 2; }
      return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-8);
    }
    const scored = all.map(e => {
      let s = 0.0;
      if (qvec && e.embedding?.length) s += cosine(qvec, e.embedding);
      else {
        const kw = (e.keywords || []).join(' ');
        const inter = kw && query ? kw.split(/\W+/).filter(w => query.includes(w)).length : 0;
        s += inter * 0.05;
      }
      const days = (Date.now() - e.ts) / 86400000;
      if (days <= 3) s += 0.05; else if (days <= 30) s += 0.02;
      return { e, s };
    }).sort((a, b) => b.s - a.s);
    return scored.slice(0, k).map(x => x.e);
  }
}
const memory = new MemoryManager(MEMORY_PATH);

/* ========================== AGENTS ========================== */
async function agentRouter(question: string, convBrief: string, memBrief: string): Promise<RouterPlan> {
  const sys = `You are a task router. Decide whether to use the web, the topic type, and which agents to run.
Return ONLY JSON:
{
  "useWeb": true|false,
  "topic": "general|news|code|math|hci|research",
  "steps": ["Researcher","Analyst","Writer","FactChecker","Critic"],
  "maxIterations": 1-3
}
Rules: If the query implies recency (today/latest/just now/news/price/scores), set topic=news and useWeb=true. 
For coding/debug-only, you may skip Researcher and set steps=["Writer","Critic"]. In most content/research queries include "FactChecker". Keep it minimal and practical.`;
  const messages: ChatMsg[] = [
    { role: 'system', content: sys },
    { role: 'user', content: `Question:\n${question}\n\n(Conversation brief)\n${convBrief}\n\n(Relevant memory)\n${memBrief}` }
  ];
  const res = await openai.chat.completions.create({ model: ROUTER_MODEL, messages });
  TOKENS.record('Router', ROUTER_MODEL, messages, res.choices[0]?.message?.content || '', res.usage as any);
  const text = res.choices[0]?.message?.content || '{}';
  const body = text.match(/```json([\s\S]*?)```/i)?.[1] ?? text;
  try { return RouterPlanSchema.parse(JSON.parse(body)); }
  catch { return { useWeb: true, topic: 'general', steps: ['Researcher','Analyst','Writer','FactChecker','Critic'], maxIterations: 2 }; }
}

async function agentResearcher(question: string, useWeb: boolean, topic: 'general'|'news'): Promise<ResearchBundle> {
  const queries = await expandQueries(question);
  const allSources = useWeb ? await webSearchMulti(queries, topic, SPEED_MODE === 'fast' ? 8 : SEARCH_MAX_RESULTS) : [];
  const sources = diversifySources(allSources, SPEED_MODE === 'thorough' ? 12 : 10);

  const fetchN = SPEED_MODE === 'fast' ? FETCH_PAGES_FAST : SPEED_MODE === 'thorough' ? FETCH_PAGES_THO : FETCH_PAGES_BAL;
  const pages = await Promise.all(sources.slice(0, fetchN).map(s => fetchPageTool(s.url)));
  const context = pages.map(p => `# ${p.title || p.url}\n${clip(p.content || '', 1600)}`).join('\n\n');

  const sys = `You are a meticulous research agent. Produce ONLY JSON:
{
  "id": "...",
  "query": "<original question>",
  "sources": [ { "title": "...", "url": "https://...", "snippet": "...", "published": "YYYY-MM-DD" } ],
  "facts":   [ { "statement": "verifiable, quotable fact", "source": "https://...", "evidence": "short quote", "published": "YYYY-MM-DD" } ]
}
Rules:
- Extract ${SPEED_MODE==='fast'?'8~12':'12~18'} high-value facts if possible, each backed by one of the sources URLs.
- Prefer diverse domains and up-to-date info when relevant.
- No hallucinations.`;
  const messages: ChatMsg[] = [
    { role: 'system', content: sys },
    { role: 'user', content: `Question: ${question}\n\nScraped snippets (diverse languages allowed):\n${context}\n\nDiverse sources list:\n${JSON.stringify(sources, null, 2)}` }
  ];
  const res = await openai.chat.completions.create({
    model: RESEARCH_MODEL, temperature: RESEARCH_TEMPERATURE, messages,
  });
  TOKENS.record('Researcher', RESEARCH_MODEL, messages, res.choices[0]?.message?.content || '', res.usage as any);
  const text = res.choices[0]?.message?.content || '{}';
  const code = text.match(/```json([\s\S]*?)```/i)?.[1] ?? text;

  try {
    const parsed = JSON.parse(code);
    parsed.sources = dedupAndScore(parsed.sources || sources || []);
    return ResearchBundleSchema.parse(parsed);
  } catch {
    const fallback = diversifySources(sources, Math.min(6, sources.length));
    return {
      id: nanoid(),
      query: question,
      sources: fallback,
      facts: (fallback.map(s => ({
        statement: s.snippet || `Reference ${s.title || s.url}`,
        source: s.url,
        evidence: s.snippet || '',
        published: s.published
      }))) as Fact[],
    };
  }
}

async function agentAnalyst(input: ResearchBundle): Promise<ResearchBundle> {
  const sys = `You are an analyst. Input is a ResearchBundle JSON.
Tasks:
- Keep a rich set of facts (ideally 10+ if available). Remove only duplicates or contradictions.
- Keep top-8 diverse sources (respect "score" and domain diversity).
Output MUST be the same JSON structure.`;
  const messages: ChatMsg[] = [
    { role: 'system', content: sys },
    { role: 'user', content: JSON.stringify(input) }
  ];
  const res = await openai.chat.completions.create({
    model: RESEARCH_MODEL, temperature: ANALYST_TEMPERATURE, messages,
  });
  TOKENS.record('Analyst', RESEARCH_MODEL, messages, res.choices[0]?.message?.content || '', res.usage as any);
  const text = res.choices[0]?.message?.content || '{}';
  const body = text.match(/```json([\s\S]*?)```/i)?.[1] ?? text;
  try { return ResearchBundleSchema.parse(JSON.parse(body)); }
  catch { return input; }
}

async function agentWriter(finalBundle: ResearchBundle, convBrief: string, memBrief: string, stream = true) {
  const lang = resolveTargetLang(finalBundle.query);
  const sys = `You are the final writer.
- Write in the target language: ${lang}.
- Use clear section headings in the target language.
- Target length: ${SPEED_MODE==='fast'?'450~700':'600~900'} words (or more if needed).
- Suggested structure (adapt as needed):
  1) Summary (2–4 sentences)
  2) Full Answer (steps/comparison/data)
  3) Limitations or counterpoints
  4) Actionable checklist (bullet points)
  5) References (domain/title + URL)
- Ground concrete claims in the provided facts; you MAY add neutral background context for readability, but label it "Background" and avoid unverifiable specific numbers there.`;
  const messages: ChatMsg[] = [{
    role: 'system', content: sys
  }, {
    role: 'user',
    content: `Question:
${finalBundle.query}

(Conversation brief)
${convBrief}

(Relevant memory)
${memBrief}

(Verifiable facts: use these for concrete claims)
${JSON.stringify(finalBundle.facts, null, 2)}

(Sources, deduped and diverse)
${JSON.stringify(finalBundle.sources.slice(0, 8), null, 2)}`
  }];

  if (!stream) {
    const res = await openai.chat.completions.create({
      model: WRITER_MODEL, temperature: WRITER_TEMPERATURE, max_tokens: WRITER_MAX_TOKENS, messages,
    });
    TOKENS.record('Writer', WRITER_MODEL, messages, res.choices[0]?.message?.content || '', res.usage as any);
    return res.choices[0]?.message?.content || '';
  }

  const resp = await openai.chat.completions.create({
    model: WRITER_MODEL, temperature: WRITER_TEMPERATURE, max_tokens: WRITER_MAX_TOKENS, messages, stream: true
  });

  process.stdout.write('\n—— 回覆 ——\n');
  let full = '';
  for await (const chunk of resp) {
    const delta = chunk.choices?.[0]?.delta?.content || '';
    full += delta;
    process.stdout.write(delta);
  }
  process.stdout.write('\n');
  TOKENS.record('Writer(stream)', WRITER_MODEL, messages, full);
  return full;
}

async function agentCritic(finalBundle: ResearchBundle, draft: string): Promise<Critique> {
  const lang = resolveTargetLang(finalBundle.query);
  const sys = `You are a strict critic. Check:
1) Grounding to the provided facts; 2) Clear structure; 3) References consistent; 4) Written in target language: ${lang}; 5) Length >= 300 words.
Return ONLY JSON:
{
  "verdict": "approve" | "revise",
  "issues": ["..."],
  "suggestions": ["..."],
  "inlineEdits": "optional full improved draft"
}`;
  const messages: ChatMsg[] = [
    { role: 'system', content: sys },
    { role: 'user', content: `(facts)
${JSON.stringify(finalBundle.facts, null, 2)}

(sources)
${JSON.stringify(finalBundle.sources.slice(0, 8), null, 2)}

(draft length = ${draft.trim().split(/\s+/).length} words)
${draft}` }
  ];
  const res = await openai.chat.completions.create({
    model: CRITIC_MODEL, temperature: CRITIC_TEMPERATURE, messages,
  });
  TOKENS.record('Critic', CRITIC_MODEL, messages, res.choices[0]?.message?.content || '', res.usage as any);
  const text = res.choices[0]?.message?.content || '{}';
  const body = text.match(/```json([\s\S]*?)```/i)?.[1] ?? text;
  try { return CritiqueSchema.parse(JSON.parse(body)); }
  catch { return { verdict:'approve', issues:[], suggestions:[] }; }
}

async function agentMemorizer(question: string, answer: string) {
  const sys = `You are a memory extractor. Return ONLY JSON:
{
  "facts":   ["long-lived, useful facts or preferences"],
  "entities":["important names/places/products/projects"],
  "keywords":["salient keywords"]
}`;
  const messages: ChatMsg[] = [
    { role: 'system', content: sys },
    { role: 'user', content: `User question: ${question}\n\nAnswer (truncated):\n${clip(answer, 1200)}` }
  ];
  const res = await openai.chat.completions.create({
    model: RESEARCH_MODEL, messages,
  });
  TOKENS.record('Memorizer', RESEARCH_MODEL, messages, res.choices[0]?.message?.content || '', res.usage as any);
  const text = res.choices[0]?.message?.content || '{}';
  const body = text.match(/```json([\s\S]*?)```/i)?.[1] ?? text;
  try {
    const obj = JSON.parse(body);
    const facts = Array.isArray(obj.facts) ? obj.facts.slice(0, 8) : [];
    const entities = Array.isArray(obj.entities) ? obj.entities.slice(0, 12) : [];
    const keywords = Array.isArray(obj.keywords) ? obj.keywords.slice(0, 20) : [];
    const toEmbed = [question, ...facts, ...entities].join('\n').slice(0, 3000);
    const embedding = (await getFirstEmbeddingOrNull(toEmbed)) || undefined;
    await memory.add({ role: 'user', text: question });
    await memory.add({ role: 'assistant', text: clip(answer, 4000), facts, entities, keywords, embedding });
  } catch { /* ignore */ }
}

/* ========================== FACT-CHECKER ========================== */
async function agentFactChecker(finalBundle: ResearchBundle, draft: string, useWeb: boolean, topic: 'general'|'news'): Promise<FactCheckReport> {
  const sysExtract = `You extract check-worthy claims. Return ONLY JSON: {"claims":["..."]}.
Rules:
- 3 to ${FACTCHECK_CLAIMS} short, atomic, verifiable claims from the draft.
- Prefer numeric comparisons, dates, rankings, or strong causal statements.
- Avoid generic advice or background context.`;
  const msg1: ChatMsg[] = [{ role: 'system', content: sysExtract }, { role: 'user', content: draft.slice(0, 5000) }];
  const res1 = await openai.chat.completions.create({
    model: RESEARCH_MODEL, temperature: 0.2, messages: msg1
  });
  TOKENS.record('FactChecker.extract', RESEARCH_MODEL, msg1, res1.choices[0]?.message?.content || '', res1.usage as any);

  const txt1 = res1.choices[0]?.message?.content || '{}';
  the_body: {
    // eslint-disable-next-line no-unused-labels
  }
  const body1 = txt1.match(/```json([\s\S]*?)```/i)?.[1] ?? txt1;
  let claims: string[] = [];
  try {
    const obj = JSON.parse(body1);
    if (Array.isArray(obj.claims)) claims = obj.claims.slice(0, FACTCHECK_CLAIMS);
  } catch {}
  if (!claims.length) return { claims: [], summary: 'No explicit claims extracted.' };

  type ClaimPack = { text: string; sources: Source[]; context: string; };
  const packs: ClaimPack[] = [];
  for (const c of claims) {
    let sources: Source[] = [];
    if (useWeb) {
      const qs = await expandQueries(c);
      const all = await webSearchMulti(qs, topic, FACTCHECK_PER_CLAIM_SOURCES);
      sources = diversifySources(all, Math.min(FACTCHECK_PER_CLAIM_SOURCES, SPEED_MODE==='fast'?6:8));
    } else {
      sources = finalBundle.sources.slice(0, 8);
    }
    const pages = await Promise.all(sources.slice(0, 3).map(s => fetchPageTool(s.url)));
    const ctx = pages.map(p => `# ${p.title || p.url}\n${clip(p.content || '', 1200)}`).join('\n\n');
    packs.push({ text: c, sources, context: ctx });
  }

  const fcSys = `You are a fact-checker. For each claim, judge with one of:
- "SUPPORTED": clearly supported by sources,
- "WEAK": somewhat suggested but not strong or missing specifics,
- "NO_EVIDENCE": not supported by provided sources,
- "CONTRADICTED": sources say the opposite.
Return ONLY JSON:
{
  "claims":[
    {"text":"...", "verdict":"SUPPORTED|WEAK|NO_EVIDENCE|CONTRADICTED", "reason":"...", "citations":["https://...","https://..."]}
  ],
  "summary":"optional brief note"
}
Choose 1-3 best citations per claim (URLs must come from the given source lists).`;
  const fcUser = packs.map((p, i) => `--- Claim ${i+1} ---
${p.text}

Sources:
${JSON.stringify(p.sources.slice(0,6), null, 2)}

Snippets:
${p.context}`).join('\n\n');
  const msg2: ChatMsg[] = [{ role: 'system', content: fcSys }, { role: 'user', content: fcUser }];
  const res2 = await openai.chat.completions.create({
    model: RESEARCH_MODEL, temperature: 0.2, messages: msg2
  });
  TOKENS.record('FactChecker.judge', RESEARCH_MODEL, msg2, res2.choices[0]?.message?.content || '', res2.usage as any);

  const txt2 = res2.choices[0]?.message?.content || '{}';
  const body2 = txt2.match(/```json([\s\S]*?)```/i)?.[1] ?? txt2;
  try {
    const parsed = FactCheckReportSchema.parse(JSON.parse(body2));
    return parsed;
  } catch {
    return { claims: claims.map(text => ({ text, verdict: 'WEAK' as const })), summary: 'Parsing failed; default to WEAK.' };
  }
}

/* ========================== HELPERS ========================== */
function summarizeHistoryShort(history: { role:'user'|'assistant'; content:string }[], limit = 6) {
  const recent = history.slice(-limit);
  return recent.map(m => (m.role === 'user' ? 'U:' : 'A:') + ' ' + clip(m.content, 160)).join('\n');
}
function formatMemBrief(mem: MemoryEntry[]) {
  if (!mem.length) return '(no relevant memory)';
  return mem.map(m => {
    const tag = m.role === 'user' ? 'U' : 'A';
    const head = (m.facts && m.facts.length) ? `facts=${m.facts.join('; ')}` : clip(m.text, 120);
    return `• ${tag} ${new Date(m.ts).toISOString()} ${head}`;
  }).join('\n');
}
function applySpeedModeToPlan(plan: RouterPlan): RouterPlan {
  const p = { ...plan };
  if (SPEED_MODE === 'fast') {
    p.maxIterations = Math.min(p.maxIterations, 1);
    p.steps = p.steps.filter(s => s !== 'FactChecker');
  } else if (SPEED_MODE === 'thorough') {
    if (!p.steps.includes('FactChecker')) {
      const idx = p.steps.indexOf('Writer');
      p.steps.splice(idx >= 0 ? idx + 1 : p.steps.length, 0, 'FactChecker');
    }
    p.maxIterations = Math.max(p.maxIterations, 2);
  }
  return p;
}

/* ========================== EXECUTOR ========================== */
async function executePlan(
  planIn: RouterPlan,
  question: string,
  convBrief: string,
  memBrief: string
) {
  const deadline: number | null = RUNTIME_LIMIT_MS ? (Date.now() + RUNTIME_LIMIT_MS) : null;

  const plan = applySpeedModeToPlan(planIn);
  const useWeb = plan.useWeb;
  const topic = plan.topic;

  const R = SPEED_MODE === 'fast'
    ? { Router: 0.08, Researcher: 0.28, Analyst: 0.08, Writer: 0.46, Fact: 0.00, Critic: 0.10 }
    : SPEED_MODE === 'thorough'
    ? { Router: 0.08, Researcher: 0.40, Analyst: 0.10, Writer: 0.24, Fact: 0.12, Critic: 0.06 }
    : { Router: 0.08, Researcher: 0.35, Analyst: 0.10, Writer: 0.32, Fact: 0.10, Critic: 0.05 };

  const planUsed = await withBudget('Router', deadline, R.Router, 800,
    async () => plan,
    async () => ({ useWeb: true, topic: 'general', steps: ['Researcher','Analyst','Writer','Critic'], maxIterations: 1 } as RouterPlan)
  );

  let bundle: ResearchBundle | null = null;

  if (planUsed.steps.includes('Researcher')) {
    bundle = await withBudget('Researcher', deadline, R.Researcher, 1500,
      async () => agentResearcher(question, useWeb, topic === 'news' ? 'news' : 'general'),
      async () => ({
        id: nanoid(), query: question, sources: [],
        facts: [{ statement: '(research skipped by timeout)', source: 'https://example.com', evidence: '' }]
      })
    );
  }
  if (!bundle) {
    bundle = { id: nanoid(), query: question, sources: [],
      facts: [{ statement: '(no external research)', source: 'https://example.com', evidence: '' }]
    };
  }

  if (planUsed.steps.includes('Analyst')) {
    bundle = await withBudget('Analyst', deadline, R.Analyst, 800,
      async () => agentAnalyst(bundle!),
      async () => bundle!
    );
  }

  const writerStream = (deadline === null || msLeft(deadline) > 10000);
  let draft = await withBudget('Writer', deadline, R.Writer, 1500,
    async () => agentWriter(bundle!, convBrief, memBrief, writerStream),
    async () => {
      const lang = resolveTargetLang(bundle!.query);
      const f = bundle!.facts.slice(0, 6).map((x, i) => `${i+1}. ${x.statement}`).join('\n');
      const refs = bundle!.sources.slice(0, 6).map(s => `- ${domainOf(s.url)} ${s.url}`).join('\n');
      const head = label(lang, 'Time-limited concise version', '（在時間上限內給出精簡版）');
      const h1   = label(lang, 'Highlights', '重點');
      const h2   = label(lang, 'References', '參考來源');
      return `${head}\n\n${h1}:\n${f}\n\n${h2}:\n${refs}`;
    }
  );

  if (planUsed.steps.includes('FactChecker')) {
    const needFC = (SPEED_MODE !== 'fast') && msLeft(deadline) > 5000;
    if (needFC) {
      const report = await withBudget('FactChecker', deadline, R.Fact, 1200,
        async () => agentFactChecker(bundle!, draft, useWeb, topic === 'news' ? 'news' : 'general'),
        async () => ({ claims: [], summary: 'skipped by timeout' })
      );
      if (report.claims.some(c => c.verdict !== 'SUPPORTED')) {
        draft = await withBudget('Writer(FC-rewrite)', deadline, 0.12, 800,
          async () => {
            const lang = resolveTargetLang(bundle!.query);
            const sys = `You are the writer. Revise the answer per the fact-check report.
- Keep the target language: ${lang} and the structured format (Summary/Full Answer/Limitations/Checklist/References).
- Remove or soften unsupported claims; emphasize supported ones with clearer citations.`;
            const messages = [
              { role: 'system' as const, content: sys },
              { role: 'user'  as const, content:
`Original draft:
${draft}

Fact-check report (JSON):
${JSON.stringify(report, null, 2)}

Facts:
${JSON.stringify(bundle!.facts.slice(0,12), null, 2)}

Sources:
${JSON.stringify(bundle!.sources.slice(0,8), null, 2)}` }
            ];
            const res = await openai.chat.completions.create({
              model: WRITER_MODEL, temperature: WRITER_TEMPERATURE, max_tokens: WRITER_MAX_TOKENS, messages
            });
            return res.choices[0]?.message?.content || draft;
          },
          async () => draft
        );

        process.stdout.write('\n—— 回覆（修正版）——\n');
        for (const chunk of (draft.match(/[\s\S]{1,500}/g) || [])) {
          process.stdout.write(chunk);
          await sleep(3);
        }
        process.stdout.write('\n');
      }
    }
  }

  if (planUsed.steps.includes('Critic')) {
    const rounds = Math.max(1, planUsed.maxIterations ?? 1);
    for (let i = 0; i < rounds; i++) {
      if (msLeft(deadline) < 1500) break;
      const critique = await withBudget(`Critic#${i+1}`, deadline, R.Critic / rounds, 600,
        async () => agentCritic(bundle!, draft),
        async () => ({ verdict: 'approve', issues: [], suggestions: [] })
      );
      if (critique.verdict === 'approve') break;
      if (critique.inlineEdits && critique.inlineEdits.trim().length > 50) { draft = critique.inlineEdits; break; }
      draft = await withBudget(`Writer(rewrite#${i+1})`, deadline, 0.10, 700,
        async () => {
          const lang = resolveTargetLang(bundle!.query);
          const sys = `You are the writer. Rewrite the answer per the critic's suggestions.
- Keep the target language: ${lang} and keep a "References" section.`;
          const messages = [
            { role: 'system' as const, content: sys },
            { role: 'user'  as const, content:
`(issues)
${(critique.issues||[]).map((s,i)=>`${i+1}. ${s}`).join('\n')}

(suggestions)
${(critique.suggestions||[]).map((s,i)=>`${i+1}. ${s}`).join('\n')}

(original draft)
${draft}

(facts)
${JSON.stringify(bundle!.facts.slice(0,10), null, 2)}

(sources)
${JSON.stringify(bundle!.sources.slice(0,8), null, 2)}` }
          ];
          const res = await openai.chat.completions.create({
            model: WRITER_MODEL, temperature: WRITER_TEMPERATURE, max_tokens: WRITER_MAX_TOKENS, messages
          });
          return res.choices[0]?.message?.content || draft;
        },
        async () => draft
      );

      process.stdout.write('\n—— 回覆（修正版）——\n');
      for (const chunk of (draft.match(/[\s\S]{1,500}/g) || [])) {
        process.stdout.write(chunk);
        await sleep(3);
      }
      process.stdout.write('\n');
    }
  }

  return String(draft);
}

/* ========================== INTERACTIVE CLI ========================== */
async function main() {
  console.log('🚀 Multi-agent CLI — speed modes + token usage + time budget + auto language');
  console.log('Commands: :help | :mem | :clear | :export <path> | :web on|off | :plan <question> | :speed fast|balanced|thorough | :time <Nms|Ns|Nm|off|show> | :lang <auto|en|zh-TW|ja|ko> | :tokens | :exit\n');

  const rl = readline.createInterface({ input, output });
  let useWebToggle: boolean | null = null;
  const history: { role:'user'|'assistant'; content:string }[] = [];

  while (true) {
    const q = await rl.question('You: ');
    const t = q.trim();
    if (!t) continue;

    // Commands
    if (t === ':help') {
      console.log(`
:mem                 Show last 10 memory entries
:clear               Clear memory
:export <path>       Export memory JSONL to path
:web on|off          Force web search on/off (router still decides topic)
:plan <question>     Preview the router plan for a question
:speed <mode>        Set speed mode: fast | balanced | thorough
:time <Nms|Ns|Nm>    Set max time for this run (e.g., :time 20s). Use :time off to disable, :time show to view.
:lang <auto|en|zh-TW|ja|ko>  Set output language (default: auto = follow question)
:tokens              Show token usage of the last run and session totals
:exit                Quit
`); continue; }

    if (t === ':mem') {
      const all = await memory.load();
      const last10 = all.slice(-10);
      if (!last10.length) console.log('(no memory yet)');
      else {
        console.log('—— Recent Memory ——');
        for (const m of last10) {
          console.log(`${new Date(m.ts).toISOString()} [${m.role}] ${clip(m.text, 140)}`);
        }
      } continue;
    }

    if (t === ':tokens') {
      const last = TOKENS.lastRun;
      console.log('—— Tokens (last run) ——');
      for (const it of last.items) {
        console.log(`${it.label.padEnd(22)} | model=${it.model} | prompt=${it.prompt} | completion=${it.completion} | total=${it.total} | ${it.source}`);
      }
      console.log(`Totals (last): prompt=${last.totals.prompt}, completion=${last.totals.completion}, total=${last.totals.total}`);
      console.log('—— Tokens (session) ——');
      console.log(`prompt=${TOKENS.session.prompt}, completion=${TOKENS.session.completion}, total=${TOKENS.session.total}`);
      continue;
    }

    if (t === ':clear') { await memory.clear(); console.log('✅ memory cleared'); continue; }

    if (t.startsWith(':export')) {
      const parts = t.split(/\s+/);
      const p = parts[1] ? path.resolve(parts[1]) : path.resolve('./memory_export.jsonl');
      await memory.exportTo(p);
      console.log(`✅ exported to ${p}`); continue;
    }

    if (t.startsWith(':web')) {
      const parts = t.split(/\s+/);
      if (parts[1] === 'on') { useWebToggle = true; console.log('🌐 Web search: ON'); }
      else if (parts[1] === 'off') { useWebToggle = false; console.log('🌐 Web search: OFF'); }
      else console.log(`Current: ${useWebToggle === null ? 'router decides' : (useWebToggle ? 'ON' : 'OFF')} (use :web on|off)`);
      continue;
    }

    if (t.startsWith(':speed')) {
      const parts = t.split(/\s+/);
      const mode = (parts[1] as SpeedMode) || 'balanced';
      if (!['fast','balanced','thorough'].includes(mode)) {
        console.log('用法：:speed fast|balanced|thorough');
      } else {
        SPEED_MODE = mode;
        console.log(`⚡ Speed mode => ${SPEED_MODE}`);
      }
      continue;
    }

    if (t.startsWith(':time')) {
      const arg = t.replace(/^:time\s*/, '').trim();
      if (!arg || arg === 'show') {
        console.log(`當前最大時間上限：${RUNTIME_LIMIT_MS ? RUNTIME_LIMIT_MS + ' ms' : '未限制'}`);
      } else if (arg === 'off') {
        RUNTIME_LIMIT_MS = null;
        console.log('⏱ 已關閉最大時間上限（本輪起生效）');
      } else {
        const ms = parseDurationToMs(arg);
        if (!ms || ms < 1000) console.log('用法：:time <數值>[ms|s|m] ；例：:time 20s 或 :time 15000');
        else { RUNTIME_LIMIT_MS = ms; console.log(`⏱ 本輪最大時間上限已設為 ${ms} ms`); }
      }
      continue;
    }

    if (t.startsWith(':lang')) {
      const arg = t.replace(/^:lang\s*/, '').trim() as LangCode;
      if (!arg || arg === 'auto') { TARGET_LANG = 'auto'; console.log('🌐 語言模式：auto（跟隨提問語言）'); }
      else if (['en','zh-TW','ja','ko'].includes(arg)) { TARGET_LANG = arg; console.log(`🌐 語言鎖定：${TARGET_LANG}`); }
      else { console.log('用法：:lang auto|en|zh-TW|ja|ko'); }
      continue;
    }

    if (t.startsWith(':plan')) {
      const qx = t.replace(/^:plan\s*/, '') || 'Summarize the benefits of tools for LLMs';
      const mem = await memory.retrieve(qx, 6);
      const memBrief = formatMemBrief(mem);
      const convBrief = summarizeHistoryShort(history, 6);
      const planRaw = await agentRouter(qx, convBrief, memBrief);
      const plan = applySpeedModeToPlan(planRaw);
      if (useWebToggle !== null) plan.useWeb = useWebToggle;
      console.log('—— Router Plan ——');
      console.log(JSON.stringify(plan, null, 2));
      continue;
    }

    if (t === ':exit') break;

    // Normal Q&A
    history.push({ role: 'user', content: t });
    const mem = await memory.retrieve(t, 6);
    const memBrief = formatMemBrief(mem);
    const convBrief = summarizeHistoryShort(history, 8);

    TOKENS.startRun();
    const plan0 = await agentRouter(t, convBrief, memBrief);
    let plan = applySpeedModeToPlan(plan0);
    if (useWebToggle !== null) plan.useWeb = useWebToggle;

    const finalAnswer = await executePlan(plan, t, convBrief, memBrief);

    history.push({ role: 'assistant', content: finalAnswer });
    await agentMemorizer(t, finalAnswer);
    console.log('—— (memorized) ——\n');
    await sleep(30);
  }

  rl.close();
  console.log('👋 Bye!');
}
main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
