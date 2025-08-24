import { Source, Fact, RouterPlan, FactCheckReport, Emit, Settings } from '../types.js';
import { CFG, TOKEN_OPTIMIZATION } from './config.js';
import { TokenTracker } from './utils.js';
import { WebSearch } from './search.js';
import { 
  RouterAgent, 
  ResearcherAgent, 
  AnalystAgent, 
  WriterAgent, 
  FactCheckerAgent, 
  CriticAgent 
} from './agents.js';
import { CredibilityEvaluator } from './credibility.js';

// 统一的Pipeline配置
export interface PipelineConfig {
  enableTokenOptimization?: boolean;
  maxSources?: number;
  maxFacts?: number;
  maxAnalysisLength?: number;
  useMinimalPrompts?: boolean;
  enableStreaming?: boolean;
  chunkSize?: number;
  chunkDelay?: number;
}

// 统一的Pipeline类
export class UnifiedResearchPipeline {
  private webSearch: WebSearch;
  private routerAgent: RouterAgent;
  private researcherAgent: ResearcherAgent;
  private analystAgent: AnalystAgent;
  private writerAgent: WriterAgent;
  private factCheckerAgent: FactCheckerAgent;
  private criticAgent: CriticAgent;
  private credibilityEvaluator: CredibilityEvaluator;
  private tokenTracker: TokenTracker;
  private config: Required<PipelineConfig>;

  constructor(config: PipelineConfig = {}) {
    // 设置默认配置
    this.config = {
      enableTokenOptimization: true,
      maxSources: TOKEN_OPTIMIZATION.MAX_SOURCES,
      maxFacts: TOKEN_OPTIMIZATION.MAX_FACTS,
      maxAnalysisLength: TOKEN_OPTIMIZATION.MAX_ANALYSIS_LENGTH,
      useMinimalPrompts: TOKEN_OPTIMIZATION.USE_MINIMAL_PROMPTS,
      enableStreaming: true,
      chunkSize: 50,
      chunkDelay: 30,
      ...config
    };

    this.webSearch = new WebSearch();
    this.routerAgent = new RouterAgent();
    this.researcherAgent = new ResearcherAgent();
    this.analystAgent = new AnalystAgent();
    this.writerAgent = new WriterAgent();
    this.factCheckerAgent = new FactCheckerAgent();
    this.criticAgent = new CriticAgent();
    this.credibilityEvaluator = new CredibilityEvaluator();
    this.tokenTracker = new TokenTracker();
    
    // 为所有agents设置token追踪器
    this.routerAgent.setTokenTracker(this.tokenTracker);
    this.researcherAgent.setTokenTracker(this.tokenTracker);
    this.analystAgent.setTokenTracker(this.tokenTracker);
    this.writerAgent.setTokenTracker(this.tokenTracker);
    this.factCheckerAgent.setTokenTracker(this.tokenTracker);
    this.criticAgent.setTokenTracker(this.tokenTracker);
  }

  // 运行统一的研究流程
  async runPipeline(
    question: string,
    settings: Settings,
    emit: Emit
  ): Promise<void> {
    console.log(`[UnifiedPipeline] 开始处理问题: "${question}"`);
    console.log(`[UnifiedPipeline] 配置:`, this.config);
    console.log(`[UnifiedPipeline] 设置:`, settings);
    
    const startTime = Date.now();
    
    try {
      // 1. 路由器阶段
      const plan = await this.safeExecute(
        () => this.routerAgent.plan(question, settings.lang),
        '路由器规划失败',
        emit
      );
      if (!plan) return;
      await emit('router', plan);
      
      // 2. 搜索阶段
      let sources: Source[] = [];
      if (plan.useWeb) {
        sources = await this.safeExecute(
          () => this.performOptimizedWebSearch(question, plan, settings),
          '网络搜索失败',
          emit
        ) || [];
        if (sources.length > 0) {
          await emit('sources', sources);
        }
      }
      
      // 3. 研究阶段
      const facts = await this.safeExecute(
        () => this.researcherAgent.extractFacts(sources, question, settings.lang),
        '事实提取失败',
        emit
      ) || [];
      if (facts.length > 0) {
        await emit('facts', facts);
      }
      
      // 4. 分析阶段
      const analysis = await this.safeExecute(
        () => this.analystAgent.analyze(facts, question, settings.lang),
        '分析失败',
        emit
      ) || '分析失败，将基于事实直接生成回答';
      
      // 5. 写作阶段
      await this.safeExecute(
        () => this.performOptimizedWriting(analysis, facts, question, settings, emit),
        '写作失败',
        emit
      );
      
      // 6. 事实查核阶段（仅在非fast模式）
      if (settings.speedMode !== 'fast') {
        await this.safeExecute(
          async () => {
            const currentResponse = await this.getCurrentResponse(emit);
            const factReport = await this.factCheckerAgent.factCheck(
              currentResponse, 
              sources, 
              settings.lang
            );
            await emit('factcheck', factReport);
          },
          '事实查核失败',
          emit
        );
      }
      
      // 7. 评论阶段（仅在thorough模式）
      if (settings.speedMode === 'thorough') {
        await this.safeExecute(
          async () => {
            const currentResponse = await this.getCurrentResponse(emit);
            const critique = await this.criticAgent.critique(currentResponse, settings.lang);
            await emit('critique', { feedback: critique });
          },
          '评论失败',
          emit
        );
      }
      
      // 8. 发送token统计
      const tokenUsage = this.tokenTracker.usage();
      await emit('tokens', tokenUsage);
      
      // 9. 完成
      await emit('done', {});
      
      const endTime = Date.now();
      console.log(`[UnifiedPipeline] 流程完成，耗时: ${endTime - startTime}ms`);
      console.log(`[UnifiedPipeline] Token使用:`, tokenUsage);
      
    } catch (error) {
      console.error('[UnifiedPipeline] 流程执行失败:', error);
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      await emit('error', { message: '流程执行失败', error: errorMessage });
    }
  }

  // 统一的错误处理装饰器
  private async safeExecute<T>(
    operation: () => Promise<T>,
    errorMessage: string,
    emit: Emit
  ): Promise<T | null> {
    try {
      return await operation();
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '未知错误';
      await emit('error', { message: errorMessage, error: errorMsg });
      return null;
    }
  }

  // 优化后的网络搜索
  private async performOptimizedWebSearch(
    question: string, 
    plan: RouterPlan, 
    settings: Settings
  ): Promise<Source[]> {
    const searchParams = {
      max_results: this.config.maxSources,
      search_depth: 'basic' as const
    };
    
    // 使用查询扩展但限制结果数量
    const expandedQueries = this.webSearch.expandQueries(question);
    const allSources: Source[] = [];
    
    for (const query of expandedQueries.slice(0, 2)) { // 最多2个查询
      const sources = await this.webSearch.search(query, searchParams);
      allSources.push(...sources);
      
      // 如果已经找到足够的来源，就停止搜索
      if (allSources.length >= this.config.maxSources) {
        break;
      }
    }
    
    // 去重并限制数量
    const uniqueSources = this.deduplicateSources(allSources);
    return uniqueSources.slice(0, this.config.maxSources);
  }

  // 去重来源
  private deduplicateSources(sources: Source[]): Source[] {
    const seen = new Set<string>();
    return sources.filter(source => {
      const key = source.url;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // 优化后的写作流程
  private async performOptimizedWriting(
    analysis: string,
    facts: Fact[],
    question: string,
    settings: Settings,
    emit: Emit
  ): Promise<void> {
    // 使用优化后的参数调用写作代理
    const response = await this.writerAgent.write(analysis, facts, question, settings.lang);
    
    if (this.config.enableStreaming) {
      // 流式输出
      await this.streamResponse(response, emit);
    } else {
      // 一次性输出
      await emit('writer', { chunk: response });
    }
  }

  // 真正的流式输出
  private async streamResponse(
    response: string,
    emit: Emit
  ): Promise<void> {
    const chunks = this.chunkText(response, this.config.chunkSize);
    for (const chunk of chunks) {
      await emit('writer', { chunk });
      if (this.config.chunkDelay > 0) {
        await this.delay(this.config.chunkDelay);
      }
    }
  }

  // 文本分块
  private chunkText(text: string, chunkSize: number): string[] {
    const chunks: string[] = [];
    for (let i = 0; i < text.length; i += chunkSize) {
      chunks.push(text.slice(i, i + chunkSize));
    }
    return chunks;
  }

  // 获取当前响应内容
  private async getCurrentResponse(emit: Emit): Promise<string> {
    // 这里需要实现获取当前完整响应的逻辑
    // 简化实现，返回一个占位符
    return "当前响应内容";
  }

  // 延迟函数
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // 获取配置
  getConfig(): Required<PipelineConfig> {
    return { ...this.config };
  }

  // 更新配置
  updateConfig(newConfig: Partial<PipelineConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  // 获取token使用统计
  getTokenUsage() {
    return this.tokenTracker.usage();
  }

  // 重置token统计
  resetTokenUsage(): void {
    this.tokenTracker = new TokenTracker();
    // 重新设置所有agents的token追踪器
    this.routerAgent.setTokenTracker(this.tokenTracker);
    this.researcherAgent.setTokenTracker(this.tokenTracker);
    this.analystAgent.setTokenTracker(this.tokenTracker);
    this.writerAgent.setTokenTracker(this.tokenTracker);
    this.factCheckerAgent.setTokenTracker(this.tokenTracker);
    this.criticAgent.setTokenTracker(this.tokenTracker);
  }
}
