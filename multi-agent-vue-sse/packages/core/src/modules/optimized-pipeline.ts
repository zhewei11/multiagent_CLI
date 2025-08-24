import { Source, Fact, RouterPlan, FactCheckReport, Emit, Settings } from '../types.js';
import { CFG, TOKEN_OPTIMIZATION, PipelineConfig, PipelineConfigManager } from './config.js';
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

// 優化後的研究流程 - 漸進式信息傳遞
export class OptimizedResearchPipeline {
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
    // 驗證並合併配置
    const validationErrors = PipelineConfigManager.validateConfig(config);
    if (validationErrors.length > 0) {
      throw new Error(`Invalid configuration: ${validationErrors.join(', ')}`);
    }
    
    this.config = PipelineConfigManager.mergeConfig(config);
    console.log('[OptimizedPipeline] 使用配置:', this.config);
    
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

  // 運行優化後的研究流程
  async runPipeline(
    question: string,
    settings: Settings,
    emit: Emit
  ): Promise<void> {
    console.log(`[OptimizedPipeline] 開始處理問題: "${question}"`);
    console.log(`[OptimizedPipeline] 設置:`, settings);
    
    const startTime = Date.now();
    
    try {
      // 1. 路由器階段 - 極簡規劃
      await emit('status', { stage: 'router', message: '正在分析問題...' });
      const plan = await this.safeExecute(
        () => this.routerAgent.plan(question, settings.lang),
        '路由器規劃失敗',
        emit
      );
      if (!plan) return;
      await emit('router', plan);
      
      // 2. 搜索階段 - 限制來源數量
      let sources: Source[] = [];
      if (plan.useWeb) {
        sources = await this.safeExecute(
          () => this.performOptimizedWebSearch(question, plan, settings),
          '網絡搜索失敗',
          emit
        ) || [];
        if (sources.length > 0) {
          await emit('sources', sources);
        }
      }
      
      // 3. 研究階段 - 智能事實提取
      const facts = await this.safeExecute(
        () => this.researcherAgent.extractFacts(sources, question, settings.lang),
        '事實提取失敗',
        emit
      ) || [];
      if (facts.length > 0) {
        await emit('facts', facts);
      }
      
      // 4. 分析階段 - 極簡分析
      const analysis = await this.safeExecute(
        () => this.analystAgent.analyze(facts, question, settings.lang),
        '分析失敗',
        emit
      ) || '分析失敗，將基於事實直接生成回答';
      
      // 5. 寫作階段 - 流式輸出
      await this.safeExecute(
        () => this.performOptimizedWriting(analysis, facts, question, settings, emit),
        '寫作失敗',
        emit
      );
      
      // 6. 事實查核階段（僅在非fast模式）
      if (settings.speedMode !== 'fast') {
        await this.safeExecute(
          async () => {
            const factReport = await this.factCheckerAgent.factCheck(
              await this.getCurrentResponse(emit), 
              sources, 
              settings.lang
            );
            await emit('factcheck', factReport);
          },
          '事實查核失敗',
          emit
        );
      }
      
      // 7. 評論階段（僅在thorough模式）
      if (settings.speedMode === 'thorough') {
        await this.safeExecute(
          async () => {
            const currentResponse = await this.getCurrentResponse(emit);
            const critique = await this.criticAgent.critique(currentResponse, settings.lang);
            await emit('critique', { feedback: critique });
          },
          '評論失敗',
          emit
        );
      }
      
      // 8. 發送token統計
      const tokenUsage = this.tokenTracker.usage();
      await emit('tokens', tokenUsage);
      
      // 9. 完成
      await emit('done', {});
      
      const endTime = Date.now();
      console.log(`[OptimizedPipeline] 流程完成，耗時: ${endTime - startTime}ms`);
      console.log(`[OptimizedPipeline] Token使用:`, tokenUsage);
      
    } catch (error) {
      console.error('[OptimizedPipeline] 流程執行失敗:', error);
      const errorMessage = error instanceof Error ? error.message : '未知錯誤';
      await emit('error', { message: '流程執行失敗', error: errorMessage });
    }
  }

  // 統一的錯誤處理裝飾器
  private async safeExecute<T>(
    operation: () => Promise<T>,
    errorMessage: string,
    emit: Emit
  ): Promise<T | null> {
    try {
      return await operation();
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '未知錯誤';
      await emit('error', { message: errorMessage, error: errorMsg });
      return null;
    }
  }

  // 優化後的網絡搜索
  private async performOptimizedWebSearch(
    question: string, 
    plan: RouterPlan, 
    settings: Settings
  ): Promise<Source[]> {
    const searchParams = {
      max_results: this.config.maxSources,
      search_depth: 'basic' as const
    };
    
    // 使用查詢擴展但限制結果數量
    const expandedQueries = this.webSearch.expandQueries(question);
    const allSources: Source[] = [];
    
    for (const query of expandedQueries.slice(0, 2)) { // 最多2個查詢
      const sources = await this.webSearch.search(query, searchParams);
      allSources.push(...sources);
      
      // 如果已經找到足夠的來源，就停止搜索
      if (allSources.length >= this.config.maxSources) {
        break;
      }
    }
    
    // 去重並限制數量
    const uniqueSources = this.deduplicateSources(allSources);
    return uniqueSources.slice(0, this.config.maxSources);
  }

  // 去重來源
  private deduplicateSources(sources: Source[]): Source[] {
    const seen = new Set<string>();
    return sources.filter(source => {
      const key = source.url;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // 優化後的寫作流程
  private async performOptimizedWriting(
    analysis: string,
    facts: Fact[],
    question: string,
    settings: Settings,
    emit: Emit
  ): Promise<void> {
    // 使用優化後的參數調用寫作代理
    const response = await this.writerAgent.write(analysis, facts, question, settings.lang);
    
    if (this.config.enableStreaming) {
      // 流式輸出
      await this.streamResponse(response, emit);
    } else {
      // 一次性輸出
      await emit('writer', { chunk: response });
    }
  }

  // 真正的流式輸出
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

  // 文本分塊
  private chunkText(text: string, chunkSize: number): string[] {
    const chunks: string[] = [];
    for (let i = 0; i < text.length; i += chunkSize) {
      chunks.push(text.slice(i, i + chunkSize));
    }
    return chunks;
  }

  // 獲取當前響應內容
  private async getCurrentResponse(emit: Emit): Promise<string> {
    // 這裡需要實現獲取當前完整響應的邏輯
    // 簡化實現，返回一個佔位符
    return "當前響應內容";
  }

  // 延遲函數
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // 估算系統提示詞token數
  private estimateSystemPromptTokens(settings: Settings): number {
    // 基於優化後的配置估算
    let total = 0;
    
    // 路由器提示詞
    total += 20; // 極簡提示詞
    
    // 研究員提示詞
    total += 25; // 極簡提示詞
    
    // 分析師提示詞
    total += 15; // 極簡提示詞
    
    // 作家提示詞
    total += 15; // 極簡提示詞
    
    // 事實查核提示詞（僅在非fast模式）
    if (settings.speedMode !== 'fast') {
      total += 30; // 極簡提示詞
    }
    
    // 評論提示詞（僅在thorough模式）
    if (settings.speedMode === 'thorough') {
      total += 15; // 極簡提示詞
    }
    
    return total;
  }

  // 獲取配置
  getConfig(): Required<PipelineConfig> {
    return { ...this.config };
  }

  // 更新配置
  updateConfig(newConfig: Partial<PipelineConfig>): void {
    const validationErrors = PipelineConfigManager.validateConfig(newConfig);
    if (validationErrors.length > 0) {
      throw new Error(`Invalid configuration: ${validationErrors.join(', ')}`);
    }
    this.config = PipelineConfigManager.mergeConfig({ ...this.config, ...newConfig });
  }

  // 獲取token使用統計
  getTokenUsage() {
    return this.tokenTracker.usage();
  }

  // 重置token統計
  resetTokenUsage(): void {
    this.tokenTracker = new TokenTracker();
    // 重新設置所有agents的token追蹤器
    this.routerAgent.setTokenTracker(this.tokenTracker);
    this.researcherAgent.setTokenTracker(this.tokenTracker);
    this.analystAgent.setTokenTracker(this.tokenTracker);
    this.writerAgent.setTokenTracker(this.tokenTracker);
    this.factCheckerAgent.setTokenTracker(this.tokenTracker);
    this.criticAgent.setTokenTracker(this.tokenTracker);
  }
}
