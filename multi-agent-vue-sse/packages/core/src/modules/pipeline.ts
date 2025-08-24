import { Source, Fact, RouterPlan, FactCheckReport, Emit, Settings } from '../types.js';
import { CFG } from './config.js';
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

// 主研究流程
export class ResearchPipeline {
  private webSearch: WebSearch;
  private routerAgent: RouterAgent;
  private researcherAgent: ResearcherAgent;
  private analystAgent: AnalystAgent;
  private writerAgent: WriterAgent;
  private factCheckerAgent: FactCheckerAgent;
  private criticAgent: CriticAgent;
  private credibilityEvaluator: CredibilityEvaluator;
  private tokenTracker: TokenTracker;

  constructor() {
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

  // 运行完整的研究流程
  async runPipeline(
    question: string,
    settings: Settings,
    emit: Emit
  ): Promise<void> {
    console.log(`[Pipeline] 开始处理问题: "${question}"`);
    console.log(`[Pipeline] 设置:`, settings);
    
    const startTime = Date.now();
    
    // 计算问题的 token 数
    const questionTokens = TokenTracker.countTokens(question);
    console.log(`[Pipeline] 问题 token 数: ${questionTokens}`);
    
    // 计算系统提示词的 token 数（估算）
    const systemPromptTokens = this.estimateSystemPromptTokens(settings);
    console.log(`[Pipeline] 系统提示词 token 数: ${systemPromptTokens}`);
    
    // 计算实际发送给 OpenAI 的 prompt tokens
    const actualPromptTokens = questionTokens + systemPromptTokens;
    console.log(`[Pipeline] 实际 prompt tokens: ${actualPromptTokens}`);
    
    try {
      // 1. 路由器阶段
      await emit('status', { stage: 'router', message: '正在分析问题并制定研究计划...' });
      const plan = await this.routerAgent.plan(question, settings.lang);
      await emit('router', plan);
      
      // 2. 搜索阶段
      let sources: Source[] = [];
      if (plan.useWeb) {
        try {
          await emit('status', { stage: 'search', message: '正在搜索相关信息...' });
          sources = await this.performWebSearch(question, plan, settings);
          console.log('[Pipeline] 搜索完成，找到', sources.length, '个来源');
          console.log('[Pipeline] 发送sources事件');
          await emit('sources', sources);
          console.log('[Pipeline] sources事件已发送');
        } catch (error) {
          console.error('[Pipeline] 搜索阶段失败:', error);
          const errorMessage = error instanceof Error ? error.message : '未知错误';
          await emit('error', { message: '搜索失败', error: errorMessage });
          sources = []; // 确保sources有值
        }
      }
      
      // 3. 研究阶段
      let facts: any[] = [];
      try {
        await emit('status', { stage: 'research', message: '正在提取和分析事实...' });
        facts = await this.researcherAgent.extractFacts(sources, question, settings.lang);
        console.log('[Pipeline] 事实提取完成，找到', facts.length, '个事实');
        console.log('[Pipeline] 发送facts事件');
        await emit('facts', facts);
        console.log('[Pipeline] facts事件已发送');
      } catch (error) {
        console.error('[Pipeline] 研究阶段失败:', error);
        const errorMessage = error instanceof Error ? error.message : '未知错误';
        await emit('error', { message: '事实提取失败', error: errorMessage });
        // 创建空的事实数组，确保流程继续
        facts = [];
        await emit('facts', facts);
      }
      
      // 4. 分析阶段
      await emit('status', { stage: 'analysis', message: '正在分析事实并提供见解...' });
      const analysis = await this.analystAgent.analyze(facts, question, settings.lang);
      await emit('analysis', analysis);
      
      // 5. 写作阶段
      await emit('status', { stage: 'writing', message: '正在撰写综合回答...' });
      const response = await this.writerAgent.write(analysis, facts, question, settings.lang);
      console.log('[Pipeline] 写作完成，发送response事件');
      await emit('response', response);
      console.log('[Pipeline] response事件已发送');
      
      // 6. 事实检查阶段
      await emit('status', { stage: 'factcheck', message: '正在验证事实准确性...' });
      const factCheckReport = await this.factCheckerAgent.factCheck(response, sources, settings.lang);
      console.log('[Pipeline] 事实检查完成，发送factcheck事件');
      await emit('factcheck', factCheckReport);
      console.log('[Pipeline] factcheck事件已发送');
      
      // 7. 评论阶段
      await emit('status', { stage: 'critique', message: '正在提供改进建议...' });
      const critique = await this.criticAgent.critique(response, settings.lang);
      console.log('[Pipeline] 评论完成，发送critique事件');
      await emit('critique', critique);
      console.log('[Pipeline] critique事件已发送');
      
      // 8. 可信度评估阶段
      await emit('status', { stage: 'credibility', message: '正在评估内容可信度...' });
      console.log('[Pipeline] 开始可信度评估');
      await this.performCredibilityAssessment(facts, sources, response, emit);
      console.log('[Pipeline] 可信度评估完成');
      
      // 9. 完成
      const endTime = Date.now();
      const totalTime = endTime - startTime;
      
      // 发送 token 使用情况（包含问题 token 数）
      const tokenUsage = this.tokenTracker.usage();
      await emit('tokens', {
        ...tokenUsage,
        questionTokens,
        systemTokens: systemPromptTokens,
        actualPromptTokens
      });
      
      await emit('status', { stage: 'complete', message: '研究完成！' });
      await emit('performance', {
        totalTime,
        tokenUsage: this.tokenTracker.usage(),
        credibilityStats: this.credibilityEvaluator.getPerformanceStats()
      });
      
      console.log(`[Pipeline] 流程完成，总耗时: ${totalTime}ms`);
      
    } catch (error) {
      console.error('[Pipeline] 流程执行失败:', error);
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      await emit('error', { message: '流程执行失败', error: errorMessage });
    }
  }

  // 执行网络搜索
  private async performWebSearch(question: string, plan: RouterPlan, settings: Settings): Promise<Source[]> {
    const queries = this.webSearch.expandQueries(question);
    const allSources: Source[] = [];
    
    for (const query of queries) {
      try {
        const sources = await this.webSearch.search(query, {
          search_depth: plan.topic === 'news' ? 'advanced' : 'basic',
          max_results: CFG.SEARCH_MAX_RESULTS
        });
        
        // 去重
        for (const source of sources) {
          if (!allSources.some(s => s.url === source.url)) {
            allSources.push(source);
          }
        }
        
      } catch (error) {
        console.error(`[Pipeline] 搜索查询 "${query}" 失败:`, error);
        continue;
      }
    }
    
    // 处理完所有查询后，进行域名限制和去重
    const domainCount = new Map<string, number>();
    const filteredSources: Source[] = [];
    
    for (const source of allSources) {
      try {
        const url = new URL(source.url);
        const domain = url.hostname;
        const count = domainCount.get(domain) || 0;
        
        if (count < (settings.maxPerDomain || CFG.MAX_PER_DOMAIN)) {
          domainCount.set(domain, count + 1);
          filteredSources.push(source);
        }
      } catch (error) {
        // URL 解析失败，跳过
        continue;
      }
    }
    
    return filteredSources.slice(0, CFG.SEARCH_MAX_RESULTS);
  }

  // 执行可信度评估
  private async performCredibilityAssessment(
    facts: Fact[], 
    sources: Source[], 
    response: string, 
    emit: Emit
  ): Promise<void> {
    try {
      // 提取声明进行验证
      const claims = this.extractClaims(response);
      console.log('[Pipeline] 提取到的声明:', claims);
      
      // 执行交叉验证
      console.log('[Pipeline] 执行交叉验证...');
      const crossValidationResults = await this.credibilityEvaluator.performCrossValidation(claims, sources);
      console.log('[Pipeline] 交叉验证完成，发送crossValidation事件');
      await emit('crossValidation', crossValidationResults);
      console.log('[Pipeline] crossValidation事件已发送');
      
      // 评估不确定性
      console.log('[Pipeline] 评估不确定性...');
      const uncertaintyAssessment = this.credibilityEvaluator.assessUncertainty(claims, sources);
      console.log('[Pipeline] 不确定性评估完成，发送uncertainty事件');
      await emit('uncertainty', uncertaintyAssessment);
      console.log('[Pipeline] uncertainty事件已发送');
      
      // 计算综合可信度分数
      console.log('[Pipeline] 计算可信度分数...');
      const credibilityScore = this.credibilityEvaluator.calculateCredibilityScore(
        sources, 
        claims, 
        crossValidationResults
      );
      console.log('[Pipeline] 可信度分数计算完成，发送credibility事件');
      await emit('credibility', credibilityScore);
      console.log('[Pipeline] credibility事件已发送');
      
    } catch (error) {
      console.error('[Pipeline] 可信度评估失败:', error);
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      await emit('error', { message: '可信度评估失败', error: errorMessage });
    }
  }

  // 从响应中提取声明
  private extractClaims(response: string): string[] {
    // 智能声明提取逻辑
    const sentences = response.split(/[.!?。！？]/).filter(s => s.trim().length > 10);
    const claims: string[] = [];
    
    for (const sentence of sentences) {
      const trimmed = sentence.trim();
      
      // 识别声明性语句的特征
      const isClaim = 
        // 包含事实性词汇
        /\b(is|are|was|were|has|have|had|can|could|will|would|should|may|might)\b/i.test(trimmed) ||
        // 包含数字或日期
        /\d+/.test(trimmed) ||
        // 包含比较词汇
        /\b(more|less|better|worse|larger|smaller|faster|slower)\b/i.test(trimmed) ||
        // 包含因果词汇
        /\b(because|therefore|thus|hence|as a result|leads to|causes)\b/i.test(trimmed) ||
        // 包含确定性词汇
        /\b(always|never|every|all|none|definitely|certainly)\b/i.test(trimmed);
      
      if (isClaim && claims.length < 3) {  // 从5减少到3
        claims.push(trimmed);
      }
    }
    
    // 如果没有找到声明，返回前几个句子作为备选
    if (claims.length === 0) {
      return sentences.slice(0, 2);  // 从3减少到2
    }
    
    return claims;
  }

  // 清理资源
  cleanup(): void {
    this.credibilityEvaluator.cleanup();
  }

  // 估算系统提示词的 token 数（优化后）
  private estimateSystemPromptTokens(settings: Settings): number {
    // 基础系统提示词（大幅减少）
    let baseTokens = 80; // 精简后的基础指令
    
    // 根据语言设置添加的 token（减少）
    const langTokens = settings.lang === 'auto' ? 15 : 25;
    
    // 根据速度模式添加的 token（减少）
    const speedTokens = {
      'fast': 40,
      'balanced': 70,
      'thorough': 100
    }[settings.speedMode] || 70;
    
    // 根据是否使用网络搜索添加的 token（减少）
    const webTokens = settings.useWeb ? 60 : 20;
    
    // 其他配置相关的 token（减少）
    const configTokens = 40; // 时间限制、来源限制等配置
    
    return baseTokens + langTokens + speedTokens + webTokens + configTokens;
  }
}
