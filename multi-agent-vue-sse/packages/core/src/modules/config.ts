import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 修复环境变量加载问题
const rootEnvPath = path.resolve(__dirname, '../../../../.env');
const coreEnvPath = path.resolve(__dirname, '../.env');

// 先加载项目根目录的 .env
dotenv.config({ path: rootEnvPath });
// 再加载 core 目录的 .env（会覆盖根目录的配置）
dotenv.config({ path: coreEnvPath });

// 如果还没有加载到环境变量，尝试从当前工作目录加载
if (!process.env.OPENAI_API_KEY) {
  dotenv.config();
}

// 调试：检查环境变量加载状态
console.log('[Core] 环境变量加载状态:');
console.log(`  - OPENAI_API_KEY: ${process.env.OPENAI_API_KEY ? '已配置' : '未配置'}`);
console.log(`  - TAVILY_API_KEY: ${process.env.TAVILY_API_KEY ? '已配置' : '未配置'}`);
console.log(`  - TAVILY_API_KEY 长度: ${process.env.TAVILY_API_KEY?.length || 0}`);
console.log(`  - 当前工作目录: ${process.cwd()}`);
console.log(`  - 根目录 .env 路径: ${rootEnvPath}`);
console.log(`  - Core目录 .env 路径: ${coreEnvPath}`);

// 权威来源配置
export const AUTHORITY_DOMAINS: Record<string, {
  domain: string;
  authorityScore: number;
  expertise: string[];
  verificationLevel: 'verified' | 'unverified';
}> = {
  // 学术机构
  'scholar.google.com': { domain: 'scholar.google.com', authorityScore: 0.95, expertise: ['academic', 'research'], verificationLevel: 'verified' },
  'arxiv.org': { domain: 'arxiv.org', authorityScore: 0.90, expertise: ['research', 'science'], verificationLevel: 'verified' },
  'researchgate.net': { domain: 'researchgate.net', authorityScore: 0.85, expertise: ['academic', 'research'], verificationLevel: 'verified' },
  
  // 顶级期刊
  'nature.com': { domain: 'nature.com', authorityScore: 0.92, expertise: ['science', 'research'], verificationLevel: 'verified' },
  'science.org': { domain: 'science.org', authorityScore: 0.92, expertise: ['science', 'research'], verificationLevel: 'verified' },
  'cell.com': { domain: 'cell.com', authorityScore: 0.90, expertise: ['science', 'biology'], verificationLevel: 'verified' },
  
  // 技术标准
  'ieee.org': { domain: 'ieee.org', authorityScore: 0.88, expertise: ['technology', 'engineering'], verificationLevel: 'verified' },
  'acm.org': { domain: 'acm.org', authorityScore: 0.87, expertise: ['technology', 'computer-science'], verificationLevel: 'verified' },
  
  // 政府机构
  'gov': { domain: 'gov', authorityScore: 0.85, expertise: ['government', 'policy'], verificationLevel: 'verified' },
  'who.int': { domain: 'who.int', authorityScore: 0.88, expertise: ['health', 'government'], verificationLevel: 'verified' },
  'cdc.gov': { domain: 'cdc.gov', authorityScore: 0.87, expertise: ['health', 'government'], verificationLevel: 'verified' },
  
  // 国际组织
  'un.org': { domain: 'un.org', authorityScore: 0.83, expertise: ['international', 'policy'], verificationLevel: 'verified' },
  'worldbank.org': { domain: 'worldbank.org', authorityScore: 0.85, expertise: ['economics', 'development'], verificationLevel: 'verified' },
  
  // 知名媒体（相对较低但仍有参考价值）
  'reuters.com': { domain: 'reuters.com', authorityScore: 0.75, expertise: ['news', 'business'], verificationLevel: 'verified' },
  'ap.org': { domain: 'ap.org', authorityScore: 0.78, expertise: ['news', 'general'], verificationLevel: 'verified' },
  'bbc.com': { domain: 'bbc.com', authorityScore: 0.73, expertise: ['news', 'general'], verificationLevel: 'verified' },
};

// 主配置对象
export const CFG = {
  // 模型选择 - 基于 OpenAI 官方文档优化
  WRITER_MODEL: process.env.WRITER_MODEL ?? 'gpt-4o',
  RESEARCH_MODEL: process.env.RESEARCH_MODEL ?? 'gpt-4o',
  CRITIC_MODEL: process.env.CRITIC_MODEL ?? 'gpt-4o',
  ROUTER_MODEL: process.env.ROUTER_MODEL ?? 'gpt-4o',
  EMBED_MODEL: process.env.EMBED_MODEL ?? 'text-embedding-3-large',
  
  // 模型参数优化 - 大幅减少token使用
  WRITER_TEMPERATURE: Number(process.env.WRITER_TEMPERATURE ?? '0.7'),
  WRITER_MAX_TOKENS: Number(process.env.WRITER_MAX_TOKENS ?? '1500'),  // 从4000减少到1500
  RESEARCH_TEMPERATURE: Number(process.env.RESEARCH_MODEL_TEMPERATURE ?? '0.1'),
  ANALYST_TEMPERATURE: Number(process.env.ANALYST_TEMPERATURE ?? '0.1'),
  CRITIC_TEMPERATURE: Number(process.env.CRITIC_TEMPERATURE ?? '0.2'),
  
  // 缓存和验证深度配置
  VALIDATION_DEPTH: (process.env.VALIDATION_DEPTH ?? 'balanced') as 'fast' | 'balanced' | 'thorough',
  VALIDATION_CACHE_TTL_MS: Number(process.env.VALIDATION_CACHE_TTL_MS ?? '3600000'),
  VALIDATION_CACHE_MAX_SIZE: Number(process.env.VALIDATION_CACHE_MAX_SIZE ?? '1000'),
  VALIDATION_MAX_CONCURRENT: Number(process.env.VALIDATION_MAX_CONCURRENT ?? '5'),
  VALIDATION_BATCH_SIZE: Number(process.env.VALIDATION_BATCH_SIZE ?? '3'),
  
  // 搜索和验证配置 - 大幅减少token使用
  SEARCH_MAX_RESULTS: Number(process.env.SEARCH_MAX_RESULTS ?? '4'),  // 从6减少到4
  FACTCHECK_CLAIMS: Number(process.env.FACTCHECK_CLAIMS ?? '2'),     // 从3减少到2
  FACTCHECK_PER_CLAIM_SOURCES: Number(process.env.FACTCHECK_PER_CLAIM_SOURCES ?? '3'), // 从4减少到3
  
  // 其他配置
  CACHE_TTL_MS: Number(process.env.CACHE_TTL_MS ?? '600000'),
  NEWS_DAYS: Number(process.env.NEWS_DAYS ?? '7'),
  MIN_EN_SOURCES: Number(process.env.MIN_EN_SOURCES ?? '3'),
  MAX_PER_DOMAIN: Number(process.env.MAX_PER_DOMAIN ?? '2'),
  QUERY_EXPANSION: (process.env.QUERY_EXPANSION ?? '1') !== '0',
  SEARCH_PARALLEL_NEWS: (process.env.SEARCH_PARALLEL_NEWS ?? '1') !== '0',
  MEMORY_PATH: process.env.MEMORY_PATH ?? './memory.jsonl',
};

// 新增：Token 優化配置
export const TOKEN_OPTIMIZATION = {
  // 搜索來源限制
  MAX_SOURCES: 5,
  MAX_SOURCE_TITLE_LENGTH: 20,
  MAX_SOURCE_SNIPPET_LENGTH: 30,
  
  // 事實限制
  MAX_FACTS: 3,
  MAX_FACT_LENGTH: 80,
  
  // 分析內容限制
  MAX_ANALYSIS_LENGTH: 200,
  
  // 事實查核限制
  MAX_FACTCHECK_SOURCES: 2,
  MAX_FACTCHECK_TEXT_LENGTH: 400,
  
  // 評論限制
  MAX_CRITIQUE_TEXT_LENGTH: 300,
  
  // 系統提示詞優化
  USE_MINIMAL_PROMPTS: true,
  REMOVE_LANGUAGE_DIRECTIVES: true,
  
  // 智能壓縮設置
  ENABLE_SMART_COMPRESSION: true,
  COMPRESSION_AGGRESSIVENESS: 'high' as 'low' | 'medium' | 'high'
};

// 新增：統一的Pipeline配置管理
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

export class PipelineConfigManager {
  private static readonly DEFAULT_CONFIG: Required<PipelineConfig> = {
    enableTokenOptimization: true,
    maxSources: TOKEN_OPTIMIZATION.MAX_SOURCES,
    maxFacts: TOKEN_OPTIMIZATION.MAX_FACTS,
    maxAnalysisLength: TOKEN_OPTIMIZATION.MAX_ANALYSIS_LENGTH,
    useMinimalPrompts: TOKEN_OPTIMIZATION.USE_MINIMAL_PROMPTS,
    enableStreaming: true,
    chunkSize: 50,
    chunkDelay: 30
  };

  static getDefaultConfig(): Required<PipelineConfig> {
    return { ...this.DEFAULT_CONFIG };
  }

  static mergeConfig(userConfig: Partial<PipelineConfig>): Required<PipelineConfig> {
    return { ...this.DEFAULT_CONFIG, ...userConfig };
  }

  static validateConfig(config: PipelineConfig): string[] {
    const errors: string[] = [];
    
    if (config.maxSources && config.maxSources < 1) {
      errors.push('maxSources 必須至少為 1');
    }
    
    if (config.maxFacts && config.maxFacts < 1) {
      errors.push('maxFacts 必須至少為 1');
    }
    
    if (config.chunkSize && config.chunkSize < 10) {
      errors.push('chunkSize 必須至少為 10');
    }
    
    if (config.chunkDelay && config.chunkDelay < 0) {
      errors.push('chunkDelay 必須為非負數');
    }
    
    return errors;
  }
}
