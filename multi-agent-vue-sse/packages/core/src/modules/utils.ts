import { get_encoding } from '@dqbd/tiktoken';

// 初始化编码器
const ENCODER = get_encoding('cl100k_base');
process.on('exit', () => { try { ENCODER.free(); } catch {} });

// 工具函數
export function hasCJK(s: string): boolean { 
  return /[\u4E00-\u9FFF]/.test(s); 
}

export function tryParseJSON(s: string): any | null {
  try { return JSON.parse(s); } catch {}
  
  // 嘗試提取markdown代碼塊中的JSON
  const codeBlockMatch = s.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) {
    try { return JSON.parse(codeBlockMatch[1].trim()); } catch {}
  }
  
  // 嘗試提取第一個JSON對象
  const objMatch = s.match(/\{[\s\S]*\}/); 
  if (objMatch) { 
    try { return JSON.parse(objMatch[0]); } catch {} 
  }
  
  // 嘗試提取JSON數組
  const arrayMatch = s.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try { return JSON.parse(arrayMatch[0]); } catch {}
  }
  
  return null;
}

export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Token 追蹤器
export class TokenTracker {
  private prompt = 0; 
  private completion = 0;
  
  addPromptText(txt: string) { this.prompt += this.count(txt); }
  addCompletionText(txt: string) { this.completion += this.count(txt); }
  
  private count(text: string) { 
    try { return ENCODER.encode(text).length; } 
    catch { return Math.ceil(text.length/4); } 
  }
  
  // 新增：靜態方法，用於計算單個文本的 token 數
  static countTokens(text: string): number {
    try { return ENCODER.encode(text).length; } 
    catch { return Math.ceil(text.length/4); } 
  }
  
  usage() { 
    return { 
      prompt: this.prompt, 
      completion: this.completion, 
      total: this.prompt + this.completion 
    }; 
  }
}

// 語言指令生成器（進一步精簡）
export function langDirective(lang: 'auto' | 'en' | 'zh-TW' | 'ja' | 'ko'): string {
  switch (lang) {
    case 'en':    return 'Use English';
    case 'zh-TW': return 'Use Traditional Chinese';
    case 'ja':    return 'Use Japanese';
    case 'ko':    return 'Use Korean';
    case 'auto':
    default:      return 'Use same language as question';
  }
}

// 智能文本截斷工具
export function smartTruncate(text: string, maxLength: number, preserveWords = true): string {
  if (text.length <= maxLength) return text;
  
  if (preserveWords) {
    const truncated = text.substring(0, maxLength);
    const lastSpace = truncated.lastIndexOf(' ');
    return lastSpace > maxLength * 0.8 ? truncated.substring(0, lastSpace) + '...' : truncated + '...';
  }
  
  return text.substring(0, maxLength) + '...';
}

// 智能內容壓縮 - 移除冗餘信息
export function compressContent(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  
  // 移除常見的冗餘詞彙和短語
  let compressed = text
    .replace(/\b(the|a|an|and|or|but|in|on|at|to|for|of|with|by)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  
  // 如果仍然過長，進行截斷
  if (compressed.length > maxLength) {
    compressed = smartTruncate(compressed, maxLength);
  }
  
  return compressed;
}

// 計算壓縮後的token節省
export function calculateTokenSavings(original: string, compressed: string): number {
  const originalTokens = TokenTracker.countTokens(original);
  const compressedTokens = TokenTracker.countTokens(compressed);
  return originalTokens - compressedTokens;
}

// 計算文本的token效率（字符/token比率）
export function getTokenEfficiency(text: string): number {
  const tokenCount = TokenTracker.countTokens(text);
  return tokenCount > 0 ? text.length / tokenCount : 0;
}
