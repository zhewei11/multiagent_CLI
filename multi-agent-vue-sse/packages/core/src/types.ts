/* -------------------------------- Types -------------------------------- */

// 基礎類型
export interface Source { 
  title?: string; 
  url: string; 
  snippet?: string; 
  published?: string; 
}

export interface Fact { 
  statement: string; 
  source: string; 
  evidence?: string; 
  published?: string; 
}

export interface ResearchBundle { 
  id: string; 
  query: string; 
  sources: Source[]; 
  facts: Fact[]; 
}

export interface RouterPlan { 
  useWeb: boolean; 
  topic: 'general' | 'news'; 
  steps: string[]; 
  maxIterations: number; 
}

export interface FactCheckItem { 
  text: string; 
  verdict: 'SUPPORTED' | 'WEAK' | 'NO_EVIDENCE' | 'CONTRADICTED'; 
}

export interface FactCheckReport { 
  claims: FactCheckItem[]; 
  summary?: string; 
}

export interface TokenUsage { 
  prompt: number; 
  completion: number; 
  total: number; 
  questionTokens?: number; // 用戶問題的原始 token 數
  systemTokens?: number;   // 系統提示詞和上下文的 token 數
  actualPromptTokens?: number; // 实际发送给 OpenAI 的 prompt tokens
}

export interface Settings {
  speedMode: 'fast' | 'balanced' | 'thorough';
  lang: 'auto' | 'en' | 'zh-TW' | 'ja' | 'ko';
  useWeb: boolean;
  timeLimitMs?: number | null;
  minEnSources?: number;
  maxPerDomain?: number;
  queryExpansion?: boolean;
}

export type Emit = (event: string, payload: any) => void | Promise<void>;

// 高優先級改進功能接口
export interface SourceAuthority {
  domain: string;
  authorityScore: number;
  expertise: string[];
  verificationLevel: 'verified' | 'unverified';
  lastVerified?: string;
}

export interface CrossValidationResult {
  claim: string;
  supportingSources: Source[];
  contradictingSources: Source[];
  confidence: number;
  consensus: 'strong' | 'weak' | 'conflicting';
  evidenceStrength: 'high' | 'medium' | 'low';
}

export interface UncertaintyAssessment {
  confidence: number;
  uncertaintyFactors: string[];
  alternativeHypotheses: string[];
  recommendation: 'proceed' | 'caution' | 'reject';
  riskLevel: 'low' | 'medium' | 'high';
}

export interface CredibilityScore {
  overall: number;
  breakdown: {
    sourceQuality: number;
    factChecking: number;
    crossValidation: number;
    temporalValidity: number;
    authorityWeight: number;
  };
  recommendations: string[];
  warnings: string[];
}

// 中優先級功能接口
export interface AcademicCitation {
  type: 'journal' | 'conference' | 'book' | 'report' | 'website' | 'news';
  authors: string[];
  title: string;
  venue: string;
  year: number;
  url?: string;
  doi?: string;
  issn?: string;
  isbn?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  publisher?: string;
  impactFactor?: number;
  citations?: number;
}

export interface CitationReport {
  citations: AcademicCitation[];
  totalCitations: number;
  citationFormats: {
    apa: string[];
    mla: string[];
    chicago: string[];
    harvard: string[];
  };
  qualityMetrics: {
    academicSources: number;
    peerReviewed: number;
    recentPublications: number;
    highImpactJournals: number;
  };
}

export interface HypothesisTest {
  hypothesis: string;
  testMethod: 'statistical' | 'logical' | 'empirical' | 'comparative';
  evidence: string[];
  conclusion: 'supported' | 'rejected' | 'inconclusive' | 'partially_supported';
  confidence: number;
  pValue?: number;
  effectSize?: number;
  sampleSize?: number;
  testStatistic?: number;
  criticalValue?: number;
  reasoning: string;
  limitations: string[];
}

export interface HypothesisReport {
  tests: HypothesisTest[];
  overallConclusion: string;
  confidenceLevel: number;
  recommendations: string[];
}

export interface DataQualityMetrics {
  completeness: number;
  accuracy: number;
  consistency: number;
  timeliness: number;
  reliability: number;
  validity: number;
  uniqueness: number;
  accessibility: number;
}

export interface DataQualityReport {
  overallScore: number;
  metrics: DataQualityMetrics;
  issues: {
    critical: string[];
    major: string[];
    minor: string[];
  };
  recommendations: string[];
  qualityLevel: 'excellent' | 'good' | 'fair' | 'poor' | 'critical';
}

// 低優先級功能接口
export interface ModelVote {
  model: string;
  response: string;
  confidence: number;
  reasoning: string;
  timestamp: number;
  metadata: {
    modelVersion: string;
    temperature: number;
    maxTokens: number;
    responseTime: number;
  };
}

export interface ModelConsensus {
  consensus: string;
  confidence: number;
  agreement: number;
  dissentingViews: string[];
  modelAgreement: {
    [model: string]: 'agree' | 'disagree' | 'neutral';
  };
  votingResults: {
    totalVotes: number;
    agreeVotes: number;
    disagreeVotes: number;
    neutralVotes: number;
  };
}

export interface CausalChain {
  cause: string;
  effect: string;
  mechanism: string;
  evidence: string[];
  strength: 'strong' | 'moderate' | 'weak';
  confidence: number;
  timeLag?: number;
  confoundingFactors: string[];
  alternativeExplanations: string[];
  counterEvidence: string[];
}

export interface CausalAnalysis {
  chains: CausalChain[];
  overallCausality: number;
  primaryCauses: string[];
  keyEffects: string[];
  causalStrength: 'strong' | 'moderate' | 'weak';
  limitations: string[];
  recommendations: string[];
}

export interface BiasDetection {
  types: ('selection' | 'confirmation' | 'publication' | 'language' | 'cultural' | 'temporal' | 'geographic' | 'source' | 'algorithmic')[];
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  examples: string[];
  impact: string;
  mitigation: string[];
  confidence: number;
}

export interface BiasReport {
  detectedBiases: BiasDetection[];
  overallBiasLevel: 'low' | 'medium' | 'high' | 'critical';
  biasScore: number;
  riskAssessment: string;
  mitigationStrategies: string[];
  recommendations: string[];
}
