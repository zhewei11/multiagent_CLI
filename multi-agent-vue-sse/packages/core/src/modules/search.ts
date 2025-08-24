import { Source } from '../types.js';

// 網絡搜索功能
export class WebSearch {
  private tavilyKey: string;

  constructor() {
    this.tavilyKey = process.env.TAVILY_API_KEY || '';
  }

  // 獲取 Tavily API 密鑰
  private getTavilyKey(): string {
    return process.env.TAVILY_API_KEY || '';
  }

  // Tavily 搜索
  async search(query: string, params: { search_depth?: 'basic'|'advanced'; max_results?: number } = {}, signal?: AbortSignal): Promise<Source[]> {
    console.log(`[Tavily] 開始搜索: "${query}"`);
    console.log(`[Tavily] TAVILY_KEY 狀態: ${this.getTavilyKey() ? '已配置' : '未配置'}`);
    console.log(`[Tavily] TAVILY_KEY 長度: ${this.getTavilyKey()?.length || 0}`);
    
    if (!this.getTavilyKey()) {
      console.warn('[Tavily] 缺少 TAVILY_API_KEY，跳過網絡搜索');
      return [];
    }
    
    const body = { 
      api_key: this.getTavilyKey(), 
      query, 
      include_answer: false, 
      search_depth: params.search_depth ?? 'basic', 
      max_results: params.max_results ?? 5 
    };
    console.log(`[Tavily] 搜索參數:`, { query, search_depth: body.search_depth, max_results: body.max_results });
    
    try {
      console.log(`[Tavily] 發送請求到: https://api.tavily.com/search`);
      const res = await fetch('https://api.tavily.com/search', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify(body), 
        signal 
      });
      console.log(`[Tavily] 響應狀態: ${res.status} ${res.statusText}`);
      
      if (!res.ok) {
        const errorText = await res.text();
        console.error(`[Tavily] API 錯誤: ${res.status} - ${errorText}`);
        return [];
      }
      
      const json = await res.json();
      console.log(`[Tavily] 響應數據:`, { results: json?.results?.length || 0, total: json?.total || 0 });
      
      const items = (json?.results || []) as Array<{title?:string; url:string; content?:string; published?:string}>;
      // de-dup by URL
      const seen = new Set<string>();
      const out: Source[] = [];
      for (const r of items){ 
        if (!seen.has(r.url)){ 
          seen.add(r.url); 
          out.push({ 
            title: r.title || '', 
            url: r.url, 
            snippet: r.content || '', 
            published: r.published 
          }); 
        } 
      }
      
      console.log(`[Tavily] 搜索結果: ${out.length} 個來源`);
      return out;
    } catch (e){ 
      console.error('[Tavily] 搜索失敗:', e); 
      return []; 
    }
  }

  // 查詢擴展
  expandQueries(question: string): string[] {
    const arr = [question];
    if (this.hasCJK(question)) arr.push('site:gov 最新 資訊');
    if (!/\b(what|why|how|news|latest)\b/i.test(question)) arr.push(question + ' latest');
    return [...new Set(arr)];
  }

  private hasCJK(s: string): boolean {
    return /[\u4E00-\u9FFF]/.test(s);
  }
}
