import OpenAI from 'openai';
import { CFG } from './config.js';
import { langDirective, tryParseJSON, TokenTracker, compressContent, smartTruncate } from './utils.js';
import { Source, Fact, RouterPlan, FactCheckReport, Emit } from '../types.js';

// AI 代理基類
abstract class BaseAgent {
  protected openai: OpenAI;
  protected model: string;
  protected temperature: number;
  protected maxTokens?: number;
  protected tokenTracker?: TokenTracker;

  constructor(model: string, temperature: number, maxTokens?: number) {
    this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    this.model = model;
    this.temperature = temperature;
    this.maxTokens = maxTokens;
  }

  // 設置token追蹤器
  setTokenTracker(tracker: TokenTracker) {
    this.tokenTracker = tracker;
  }

  // 智能內容選擇器
  protected selectRelevantContent<T extends { statement?: string; title?: string; snippet?: string }>(
    items: T[], 
    maxItems: number, 
    maxLength: number
  ): T[] {
    // 按相關性排序（簡單實現：按長度排序，短的通常更精煉）
    const sorted = [...items].sort((a, b) => {
      const aLen = (a.statement || a.title || a.snippet || '').length;
      const bLen = (b.statement || b.title || b.snippet || '').length;
      return aLen - bLen;
    });
    
    return sorted.slice(0, maxItems).map(item => ({
      ...item,
      statement: item.statement ? smartTruncate(item.statement, maxLength) : item.statement,
      title: item.title ? smartTruncate(item.title, maxLength / 2) : item.title,
      snippet: item.snippet ? smartTruncate(item.snippet, maxLength) : item.snippet
    }));
  }

  protected async callAPI(prompt: string, systemPrompt?: string): Promise<string> {
    try {
      const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
      if (systemPrompt) {
        messages.push({ role: 'system', content: systemPrompt });
      }
      messages.push({ role: 'user', content: prompt });

      // 記錄prompt tokens
      if (this.tokenTracker) {
        const promptText = messages.map(m => m.content).join('\n');
        this.tokenTracker.addPromptText(promptText);
      }

      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages,
        temperature: this.temperature,
        max_tokens: this.maxTokens,
      });

      const completionText = response.choices[0]?.message?.content || '';
      
      // 記錄completion tokens
      if (this.tokenTracker) {
        this.tokenTracker.addCompletionText(completionText);
      }

      return completionText;
    } catch (error) {
      console.error(`[${this.constructor.name}] API 調用失敗:`, error);
      throw error;
    }
  }


}

// 路由器代理 - 簡化提示詞
export class RouterAgent extends BaseAgent {
  constructor() {
    super(CFG.ROUTER_MODEL, 0.1);
  }

  async plan(question: string, lang: 'auto' | 'en' | 'zh-TW' | 'ja' | 'ko'): Promise<RouterPlan> {
    // 極簡系統提示詞
    const systemPrompt = `Plan: {"useWeb":bool,"topic":"general"|"news","steps":[],"maxIterations":num}`;

    // 簡化問題描述，移除語言指令
    const prompt = `Q: ${question}`;

    const response = await this.callAPI(prompt, systemPrompt);
    const parsedResponse = tryParseJSON(response);
    if (!parsedResponse) {
      console.warn('[RouterAgent] Failed to parse JSON response, using defaults');
      return {
        useWeb: true,
        topic: 'general' as const,
        steps: ['research', 'analyze', 'write'],
        maxIterations: 3
      };
    }
    const plan = parsedResponse as RouterPlan;
    
    return {
      useWeb: plan.useWeb ?? true,
      topic: plan.topic ?? 'general',
      steps: plan.steps ?? ['research', 'analyze', 'write'],
      maxIterations: plan.maxIterations ?? 3
    };
  }
}

// 研究員代理 - 智能內容壓縮
export class ResearcherAgent extends BaseAgent {
  constructor() {
    super(CFG.RESEARCH_MODEL, CFG.RESEARCH_TEMPERATURE);
  }

  async extractFacts(sources: Source[], question: string, lang: 'auto' | 'en' | 'zh-TW' | 'ja' | 'ko'): Promise<Fact[]> {
    // 極簡系統提示詞
    const systemPrompt = `Extract: {"facts":[{"statement":"","source":"","evidence":"","published":""}]}`;

    // 智能選擇最相關的來源（最多5個）
    const relevantSources = this.selectRelevantContent(sources, 5, 60);
    
    // 高度壓縮的來源文本
    const sourcesText = relevantSources.map(s => {
      const title = compressContent(s.title || s.url, 20);
      const snippet = compressContent(s.snippet || '', 30);
      return `${title}: ${snippet}`;
    }).join('|');
    
    // 簡化提示詞，移除語言指令
    const prompt = `Q: ${question}
S: ${sourcesText}`;

    const response = await this.callAPI(prompt, systemPrompt);
    const parsedResponse = tryParseJSON(response);
    if (!parsedResponse || !parsedResponse.facts) {
      console.warn('[ResearcherAgent] Failed to parse JSON response or missing facts array');
      return [];
    }
    return parsedResponse.facts || [];
  }
}

// 分析師代理 - 極簡分析
export class AnalystAgent extends BaseAgent {
  constructor() {
    super(CFG.RESEARCH_MODEL, CFG.ANALYST_TEMPERATURE);
  }

  async analyze(facts: Fact[], question: string, lang: 'auto' | 'en' | 'zh-TW' | 'ja' | 'ko'): Promise<string> {
    // 極簡系統提示詞
    const systemPrompt = `Analyze briefly.`;

    // 只選擇最重要的3個事實，每個限制長度
    const topFacts = this.selectRelevantContent(facts, 3, 80);
    const factsText = topFacts.map(f => `- ${f.statement}`).join('\n');
    
    // 極簡提示詞
    const prompt = `Q: ${question}
F: ${factsText}`;

    return await this.callAPI(prompt, systemPrompt);
  }
}

// 作家代理 - 智能內容傳遞
export class WriterAgent extends BaseAgent {
  constructor() {
    super(CFG.WRITER_MODEL, CFG.WRITER_TEMPERATURE, CFG.WRITER_MAX_TOKENS);
  }

  async write(analysis: string, facts: Fact[], question: string, lang: 'auto' | 'en' | 'zh-TW' | 'ja' | 'ko'): Promise<string> {
    // 極簡系統提示詞
    const systemPrompt = `Write response.`;

    // 只使用前3個最重要的事實，大幅截斷
    const topFacts = this.selectRelevantContent(facts, 3, 100);
    const factsText = topFacts.map(f => `- ${f.statement}`).join('\n');
    
    // 大幅截斷分析內容
    const truncatedAnalysis = smartTruncate(analysis, 200);
    
    // 極簡提示詞
    const prompt = `Q: ${question}
A: ${truncatedAnalysis}
F: ${factsText}`;

    return await this.callAPI(prompt, systemPrompt);
  }
}

// 事實檢查代理 - 極簡驗證
export class FactCheckerAgent extends BaseAgent {
  constructor() {
    super(CFG.CRITIC_MODEL, CFG.CRITIC_TEMPERATURE);
  }

  async factCheck(text: string, sources: Source[], lang: 'auto' | 'en' | 'zh-TW' | 'ja' | 'ko'): Promise<FactCheckReport> {
    // 極簡系統提示詞
    const systemPrompt = `Check: {"claims":[{"text":"","verdict":"SUPPORTED"|"WEAK"|"NO_EVIDENCE"|"CONTRADICTED"}],"summary":""}`;

    // 只選擇最相關的2個來源
    const relevantSources = this.selectRelevantContent(sources, 2, 50);
    const sourcesText = relevantSources.map(s => {
      const title = (s.title || s.url).substring(0, 25);
      const snippet = (s.snippet || '').substring(0, 40);
      return `${title}: ${snippet}`;
    }).join('|');
    
    // 大幅截斷待檢查文本
    const truncatedText = smartTruncate(text, 400);
    
    // 極簡提示詞
    const prompt = `T: ${truncatedText}
S: ${sourcesText}`;

    const response = await this.callAPI(prompt, systemPrompt);
    const parsedResponse = tryParseJSON(response);
    if (!parsedResponse) {
      console.warn('[FactCheckerAgent] Failed to parse JSON response, returning empty report');
      return { claims: [], summary: 'Failed to parse fact-check response' };
    }
    return parsedResponse;
  }
}

// 評論家代理 - 極簡反饋
export class CriticAgent extends BaseAgent {
  constructor() {
    super(CFG.CRITIC_MODEL, CFG.CRITIC_TEMPERATURE);
  }

  async critique(text: string, lang: 'auto' | 'en' | 'zh-TW' | 'ja' | 'ko'): Promise<string> {
    // 極簡系統提示詞
    const systemPrompt = `Feedback.`;

    // 大幅截斷文本
    const truncatedText = smartTruncate(text, 300);
    
    // 極簡提示詞
    const prompt = `T: ${truncatedText}`;

    return await this.callAPI(prompt, systemPrompt);
  }
}
