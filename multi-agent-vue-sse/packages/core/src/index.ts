// 主入口文件 - 导出所有核心功能

// 类型定义
export * from './types.js';

// 配置
export { CFG, AUTHORITY_DOMAINS } from './modules/config.js';

// 工具函数
export { TokenTracker, hasCJK, tryParseJSON, delay, langDirective } from './modules/utils.js';

// 缓存和并行处理
export { ValidationCache, ParallelProcessor } from './modules/cache.js';

// 网络搜索
export { WebSearch } from './modules/search.js';

// AI 代理
export { 
  RouterAgent, 
  ResearcherAgent, 
  AnalystAgent, 
  WriterAgent, 
  FactCheckerAgent, 
  CriticAgent 
} from './modules/agents.js';

// 可信度评估
export { CredibilityEvaluator } from './modules/credibility.js';

// 主流程
export { ResearchPipeline } from './modules/pipeline.js';

// 默认导出主流程类
import { ResearchPipeline } from './modules/pipeline.js';
export default ResearchPipeline;
