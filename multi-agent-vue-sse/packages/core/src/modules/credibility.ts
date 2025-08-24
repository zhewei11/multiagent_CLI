import { Source, SourceAuthority, CrossValidationResult, UncertaintyAssessment, CredibilityScore } from '../types.js';
import { AUTHORITY_DOMAINS } from './config.js';
import { ValidationCache, ParallelProcessor } from './cache.js';

// 可信度评估系统
export class CredibilityEvaluator {
  private validationCache: ValidationCache;
  private parallelProcessor: ParallelProcessor;

  constructor() {
    this.validationCache = new ValidationCache(1000, 3600000);
    this.parallelProcessor = new ParallelProcessor(5);
  }

  // 计算来源质量分数
  calculateSourceQuality(sources: Source[]): number {
    if (sources.length === 0) return 0;
    
    let totalScore = 0;
    for (const source of sources) {
      try {
        const url = new URL(source.url);
        const hostname = url.hostname.toLowerCase();
        
        // 查找权威域名
        let authorityScore = 0.5; // 默认分数
        for (const [domain, authority] of Object.entries(AUTHORITY_DOMAINS)) {
          if (hostname.includes(domain)) {
            authorityScore = authority.authorityScore;
            break;
          }
        }
        
        // 根据发布时间调整分数
        let timeScore = 1.0;
        if (source.published) {
          const publishedDate = new Date(source.published);
          const now = new Date();
          const daysDiff = (now.getTime() - publishedDate.getTime()) / (1000 * 60 * 60 * 24);
          
          if (daysDiff <= 7) timeScore = 1.0;      // 一周内
          else if (daysDiff <= 30) timeScore = 0.9; // 一个月内
          else if (daysDiff <= 90) timeScore = 0.8; // 三个月内
          else if (daysDiff <= 365) timeScore = 0.7; // 一年内
          else timeScore = 0.6;                      // 一年以上
        }
        
        // 综合分数
        const sourceScore = (authorityScore * 0.7) + (timeScore * 0.3);
        totalScore += sourceScore;
        
      } catch (error) {
        // URL 解析失败，给予较低分数
        totalScore += 0.3;
      }
    }
    
    // 确保返回0-100的分数
    const finalScore = Math.round((totalScore / sources.length) * 100);
    return Math.max(0, Math.min(100, finalScore));
  }

  // 计算事实查核分数
  calculateFactCheckingScore(facts: string[], sources: Source[]): number {
    if (facts.length === 0) return 0;
    
    // 基于事实数量和来源质量计算
    const sourceQuality = this.calculateSourceQuality(sources);
    const factDensity = Math.min(facts.length / 5, 1); // 标准化事实密度
    
    const score = Math.round((sourceQuality * 0.6) + (factDensity * 40));
    return Math.max(0, Math.min(100, score)); // 确保在0-100范围内
  }

  // 执行交叉验证
  async performCrossValidation(claims: string[], sources: Source[]): Promise<CrossValidationResult[]> {
    console.log('[CrossValidation] 开始交叉验证');
    console.log('[CrossValidation] 声明数量:', claims.length);
    console.log('[CrossValidation] 来源数量:', sources.length);
    console.log('[CrossValidation] 声明列表:', claims);
    
    const results: CrossValidationResult[] = [];
    
    for (let i = 0; i < claims.length; i++) {
      const claim = claims[i];
      console.log(`[CrossValidation] 处理第${i + 1}个声明: "${claim}"`);
      
      // 检查缓存
      const cached = this.validationCache.get(claim, sources);
      if (cached) {
        console.log(`[CrossValidation] 使用缓存结果`);
        results.push(cached);
        continue;
      }
      
      // 执行验证
      const result = await this.validateClaim(claim, sources);
      console.log(`[CrossValidation] 验证结果:`, {
        confidence: result.confidence,
        consensus: result.consensus,
        evidenceStrength: result.evidenceStrength,
        supportingSources: result.supportingSources.length,
        contradictingSources: result.contradictingSources.length
      });
      results.push(result);
      
      // 缓存结果
      this.validationCache.set(claim, sources, result);
    }
    
    console.log('[CrossValidation] 交叉验证完成，总结果数量:', results.length);
    return results;
  }

  // 验证单个声明
  private async validateClaim(claim: string, sources: Source[]): Promise<CrossValidationResult> {
    console.log(`[ValidateClaim] 验证声明: "${claim}"`);
    const supportingSources: Source[] = [];
    const contradictingSources: Source[] = [];
    
    // 分析来源对声明的支持程度
    for (let i = 0; i < sources.length; i++) {
      const source = sources[i];
      const supportLevel = this.analyzeSourceSupport(claim, source);
      console.log(`[ValidateClaim] 来源${i + 1} "${source.title}" 支持度: ${supportLevel.toFixed(3)}`);
      
      if (supportLevel > 0.45) {  // 降低支持阈值，让更多来源被归类为支持
        supportingSources.push(source);
        console.log(`[ValidateClaim] -> 归类为支持来源`);
      } else if (supportLevel < 0.25) {  // 提高矛盾阈值，减少误判
        contradictingSources.push(source);
        console.log(`[ValidateClaim] -> 归类为矛盾来源`);
      } else {
        console.log(`[ValidateClaim] -> 归类为中性来源`);
      }
    }
    
    console.log(`[ValidateClaim] 分析完成 - 支持:${supportingSources.length}, 矛盾:${contradictingSources.length}, 中性:${sources.length - supportingSources.length - contradictingSources.length}`);
    
    // 计算置信度
    const confidence = this.calculateConfidence(supportingSources, contradictingSources);
    console.log(`[ValidateClaim] 计算置信度: ${confidence}%`);
    
    // 确定共识程度
    let consensus: 'strong' | 'weak' | 'conflicting';
    if (supportingSources.length > contradictingSources.length * 2) {
      consensus = 'strong';
    } else if (contradictingSources.length === 0) {
      consensus = 'weak';
    } else {
      consensus = 'conflicting';
    }
    console.log(`[ValidateClaim] 共识程度: ${consensus}`);
    
    // 确定证据强度
    let evidenceStrength: 'high' | 'medium' | 'low';
    if (supportingSources.length >= 3) {
      evidenceStrength = 'high';
    } else if (supportingSources.length >= 1) {
      evidenceStrength = 'medium';
    } else {
      evidenceStrength = 'low';
    }
    console.log(`[ValidateClaim] 证据强度: ${evidenceStrength}`);
    
    return {
      claim,
      supportingSources,
      contradictingSources,
      confidence,
      consensus,
      evidenceStrength
    };
  }

  // 分析来源对声明的支持程度
  private analyzeSourceSupport(claim: string, source: Source): number {
    const content = (source.title || '') + ' ' + (source.snippet || '');
    const claimWords = claim.toLowerCase().split(/\s+/);
    const contentWords = content.toLowerCase().split(/\s+/);
    
    console.log(`[AnalyzeSupport] 分析声明: "${claim.substring(0, 50)}..."`);
    console.log(`[AnalyzeSupport] 来源内容: "${content.substring(0, 100)}..."`);
    
    // 改进的语义匹配算法
    let semanticScore = 0;
    
    // 1. 关键词匹配（权重：0.4）
    let keywordMatches = 0;
    // 改进：提取更多有意义的关键词，包括短词
    const importantWords = claimWords.filter(word => 
      word.length > 2 && 
      !['的', '在', '和', '与', '及', '等', '各', '中', '有', '是', '为', '使', '能', '可以', '具有', '展现', '显示', '表明', '说明', '通过', '分析', '理解', '深入', '更', '最', '非常', '显著', '重要', '核心', '技术', '应用', '价值', '潜力', '趋势', '发展', '现状', '未来'].includes(word)
    );
    
    for (const word of importantWords) {
      // 改进：使用更灵活的匹配（包含关系）
      if (content.toLowerCase().includes(word.toLowerCase())) {
        keywordMatches++;
      }
    }
    const keywordScore = importantWords.length > 0 ? keywordMatches / importantWords.length : 0;
    semanticScore += keywordScore * 0.4;
    console.log(`[AnalyzeSupport] 关键词匹配: ${keywordMatches}/${importantWords.length} = ${keywordScore.toFixed(3)} (贡献: ${(keywordScore * 0.4).toFixed(3)})`);
    console.log(`[AnalyzeSupport] 重要词汇: [${importantWords.join(', ')}]`);
    
    // 2. 主题相关性（权重：0.3）
    const claimTheme = this.extractTheme(claim);
    const contentTheme = this.extractTheme(content);
    const themeScore = claimTheme === contentTheme ? 1.0 : 0.3;
    semanticScore += themeScore * 0.3;
    console.log(`[AnalyzeSupport] 主题相关性: ${claimTheme} vs ${contentTheme} = ${themeScore.toFixed(3)} (贡献: ${(themeScore * 0.3).toFixed(3)})`);
    
    // 3. 情感一致性（权重：0.2）
    const claimSentiment = this.analyzeSentiment(claim);
    const contentSentiment = this.analyzeSentiment(content);
    const sentimentScore = claimSentiment === contentSentiment ? 1.0 : 0.5;
    semanticScore += sentimentScore * 0.2;
    console.log(`[AnalyzeSupport] 情感一致性: ${claimSentiment} vs ${contentSentiment} = ${sentimentScore.toFixed(3)} (贡献: ${(sentimentScore * 0.2).toFixed(3)})`);
    
    // 4. 事实性词汇匹配（权重：0.1）
    const factWords = ['data', 'research', 'study', 'survey', 'report', 'analysis', 'statistics'];
    const factScore = factWords.some(word => content.toLowerCase().includes(word)) ? 1.0 : 0.5;
    semanticScore += factScore * 0.1;
    console.log(`[AnalyzeSupport] 事实性词汇: ${factScore.toFixed(3)} (贡献: ${(factScore * 0.1).toFixed(3)})`);
    
    const finalScore = Math.max(0, Math.min(1, semanticScore));
    console.log(`[AnalyzeSupport] 最终分数: ${finalScore.toFixed(3)}`);
    
    return finalScore;
  }
  
  // 提取主题
  private extractTheme(text: string): string {
    const lowerText = text.toLowerCase();
    
    // 技术相关主题
    if (lowerText.includes('ai') || lowerText.includes('人工智能') || lowerText.includes('技术') || 
        lowerText.includes('计算机') || lowerText.includes('软件') || lowerText.includes('算法') ||
        lowerText.includes('机器学习') || lowerText.includes('深度学习') || lowerText.includes('自动化')) {
      return 'technology';
    }
    
    // 医疗健康主题
    if (lowerText.includes('医疗') || lowerText.includes('健康') || lowerText.includes('医院') || 
        lowerText.includes('疾病') || lowerText.includes('治疗') || lowerText.includes('药物')) {
      return 'health';
    }
    
    // 教育主题
    if (lowerText.includes('教育') || lowerText.includes('学校') || lowerText.includes('学习') || 
        lowerText.includes('培训') || lowerText.includes('课程') || lowerText.includes('学生')) {
      return 'education';
    }
    
    // 商业主题
    if (lowerText.includes('商业') || lowerText.includes('企业') || lowerText.includes('市场') || 
        lowerText.includes('经济') || lowerText.includes('金融') || lowerText.includes('投资')) {
      return 'business';
    }
    
    // 科学主题
    if (lowerText.includes('科学') || lowerText.includes('研究') || lowerText.includes('实验') || 
        lowerText.includes('数据') || lowerText.includes('分析') || lowerText.includes('发现')) {
      return 'science';
    }
    
    // 制造业主题
    if (lowerText.includes('制造') || lowerText.includes('工业') || lowerText.includes('生产') || 
        lowerText.includes('工厂') || lowerText.includes('设备') || lowerText.includes('工艺')) {
      return 'manufacturing';
    }
    
    return 'general';
  }
  
  // 分析情感
  private analyzeSentiment(text: string): 'positive' | 'negative' | 'neutral' {
    const positiveWords = ['good', 'great', 'excellent', 'positive', 'benefit', 'improve', 'success'];
    const negativeWords = ['bad', 'poor', 'negative', 'harm', 'damage', 'failure', 'problem'];
    
    const lowerText = text.toLowerCase();
    let positiveCount = 0;
    let negativeCount = 0;
    
    for (const word of positiveWords) {
      if (lowerText.includes(word)) positiveCount++;
    }
    for (const word of negativeWords) {
      if (lowerText.includes(word)) negativeCount++;
    }
    
    if (positiveCount > negativeCount) return 'positive';
    if (negativeCount > positiveCount) return 'negative';
    return 'neutral';
  }

  // 计算置信度
  private calculateConfidence(supporting: Source[], contradicting: Source[]): number {
    const total = supporting.length + contradicting.length;
    if (total === 0) return 0;
    
    // 基础支持率
    const supportRatio = supporting.length / total;
    
    // 来源质量加权
    let weightedSupport = 0;
    for (const source of supporting) {
      weightedSupport += this.calculateSourceQuality([source]) / 100;
    }
    const avgSourceQuality = supporting.length > 0 ? weightedSupport / supporting.length : 0;
    
    // 矛盾惩罚（考虑矛盾来源的质量）
    let contradictionPenalty = 0;
    for (const source of contradicting) {
      const sourceQuality = this.calculateSourceQuality([source]) / 100;
      contradictionPenalty += sourceQuality * 0.3; // 高质量矛盾来源惩罚更重
    }
    
    // 综合置信度计算
    let confidence = (supportRatio * 0.6) + (avgSourceQuality * 0.4) - contradictionPenalty;
    
    // 确保置信度在0-1之间
    confidence = Math.max(0, Math.min(1, confidence));
    
    // 转换为百分比
    return Math.round(confidence * 100);
  }

  // 评估不确定性
  assessUncertainty(claims: string[], sources: Source[]): UncertaintyAssessment {
    const uncertaintyFactors: string[] = [];
    const alternativeHypotheses: string[] = [];
    
    // 分析不确定性因素
    if (sources.length < 3) {
      uncertaintyFactors.push('来源数量不足');
    }
    
    if (this.calculateSourceQuality(sources) < 60) {
      uncertaintyFactors.push('来源质量较低');
    }
    
    // 生成替代假设
    if (claims.length > 0) {
      alternativeHypotheses.push('可能存在其他解释');
      alternativeHypotheses.push('数据可能不完整');
    }
    
    // 计算整体置信度
    const confidence = Math.max(0.1, 1 - (uncertaintyFactors.length * 0.2));
    
    // 确定风险等级
    let riskLevel: 'low' | 'medium' | 'high';
    if (confidence > 0.7) {
      riskLevel = 'low';
    } else if (confidence > 0.4) {
      riskLevel = 'medium';
    } else {
      riskLevel = 'high';
    }
    
    // 生成建议
    let recommendation: 'proceed' | 'caution' | 'reject';
    if (confidence > 0.6) {
      recommendation = 'proceed';
    } else if (confidence > 0.3) {
      recommendation = 'caution';
    } else {
      recommendation = 'reject';
    }
    
    return {
      confidence,
      uncertaintyFactors,
      alternativeHypotheses,
      recommendation,
      riskLevel
    };
  }

  // 计算权威权重
  calculateAuthorityWeight(sources: Source[]): number {
    if (sources.length === 0) return 0;
    
    let totalWeight = 0;
    for (const source of sources) {
      try {
        const url = new URL(source.url);
        const hostname = url.hostname.toLowerCase();
        
        let authorityScore = 0.5;
        for (const [domain, authority] of Object.entries(AUTHORITY_DOMAINS)) {
          if (hostname.includes(domain)) {
            authorityScore = authority.authorityScore;
            break;
          }
        }
        
        totalWeight += authorityScore;
      } catch (error) {
        totalWeight += 0.3;
      }
    }
    
    return Math.round((totalWeight / sources.length) * 100);
  }

  // 计算时效性
  calculateTemporalValidity(sources: Source[]): number {
    if (sources.length === 0) return 0;
    
    let totalScore = 0;
    const now = new Date();
    
    for (const source of sources) {
      if (source.published) {
        try {
          const publishedDate = new Date(source.published);
          const daysDiff = (now.getTime() - publishedDate.getTime()) / (1000 * 60 * 60 * 24);
          
          let timeScore = 0;
          if (daysDiff <= 1) timeScore = 100;      // 1天内
          else if (daysDiff <= 7) timeScore = 90;   // 1周内
          else if (daysDiff <= 30) timeScore = 80;  // 1月内
          else if (daysDiff <= 90) timeScore = 70;  // 3月内
          else if (daysDiff <= 365) timeScore = 60; // 1年内
          else timeScore = 40;                       // 1年以上
          
          totalScore += timeScore;
        } catch (error) {
          totalScore += 50; // 无法解析日期，给予中等分数
        }
      } else {
        totalScore += 50; // 没有发布日期，给予中等分数
      }
    }
    
    // 确保返回0-100的分数
    const finalScore = Math.round(totalScore / sources.length);
    return Math.max(0, Math.min(100, finalScore));
  }

  // 计算综合可信度分数
  calculateCredibilityScore(
    sources: Source[], 
    facts: string[], 
    crossValidationResults: CrossValidationResult[]
  ): CredibilityScore {
    const sourceQuality = this.calculateSourceQuality(sources);
    const factChecking = this.calculateFactCheckingScore(facts, sources);
    const crossValidation = this.calculateCrossValidationScore(crossValidationResults);
    const temporalValidity = this.calculateTemporalValidity(sources);
    const authorityWeight = this.calculateAuthorityWeight(sources);
    
    // 计算综合分数
    const overall = Math.max(0, Math.min(100, Math.round(
      (sourceQuality * 0.25) +
      (factChecking * 0.25) +
      (crossValidation * 0.25) +
      (temporalValidity * 0.15) +
      (authorityWeight * 0.10)
    )));
    
    // 生成建议和警告
    const recommendations: string[] = [];
    const warnings: string[] = [];
    
    if (sourceQuality < 70) {
      recommendations.push('建议增加更多权威来源');
      warnings.push('来源质量有待提升');
    }
    
    if (factChecking < 70) {
      recommendations.push('建议进行更深入的事实查核');
      warnings.push('事实查核不够充分');
    }
    
    if (crossValidation < 70) {
      recommendations.push('建议进行更多交叉验证');
      warnings.push('交叉验证结果不够理想');
    }
    
    if (temporalValidity < 70) {
      recommendations.push('建议使用更新的信息源');
      warnings.push('信息可能已过时');
    }
    
    if (authorityWeight < 70) {
      recommendations.push('建议增加权威机构来源');
      warnings.push('权威性来源不足');
    }
    
    return {
      overall,
      breakdown: {
        sourceQuality,
        factChecking,
        crossValidation,
        temporalValidity,
        authorityWeight
      },
      recommendations,
      warnings
    };
  }

  // 计算交叉验证分数
  private calculateCrossValidationScore(results: CrossValidationResult[]): number {
    if (results.length === 0) return 0;
    
    let totalScore = 0;
    for (const result of results) {
      let score = 0;
      
      // 基于共识程度评分（0-30分）
      switch (result.consensus) {
        case 'strong': score += 30; break;
        case 'weak': score += 15; break;
        case 'conflicting': score += 5; break;
      }
      
      // 基于证据强度评分（0-20分）
      switch (result.evidenceStrength) {
        case 'high': score += 20; break;
        case 'medium': score += 12; break;
        case 'low': score += 5; break;
      }
      
      // 基于置信度评分（0-50分）
      score += (result.confidence / 100) * 50;
      
      totalScore += score;
    }
    
    // 确保平均分在0-100范围内
    const averageScore = totalScore / results.length;
    return Math.max(0, Math.min(100, Math.round(averageScore)));
  }

  // 清理缓存
  cleanup(): void {
    this.validationCache.cleanup();
  }

  // 获取性能统计
  getPerformanceStats(): { cache: any; parallel: any } {
    return {
      cache: this.validationCache.getStats(),
      parallel: this.parallelProcessor.getStatus()
    };
  }
}
