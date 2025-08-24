import { Source } from '../types.js';

// 緩存系統
export class ValidationCache {
  private cache = new Map<string, { data: any; timestamp: number }>();
  private maxSize: number;
  private ttl: number;

  constructor(maxSize: number, ttlMs: number) {
    this.maxSize = maxSize;
    this.ttl = ttlMs;
  }

  // 生成緩存鍵
  private generateKey(fact: string, sources: Source[]): string {
    const sourceUrls = sources.map(s => s.url).sort().join('|');
    return `${fact || ''}|${sourceUrls}`;
  }

  // 獲取緩存
  get(fact: string, sources: Source[]): any | null {
    if (!fact) return null;
    const key = this.generateKey(fact, sources);
    const item = this.cache.get(key);
    
    if (!item) return null;
    
    // 檢查是否過期
    if (Date.now() - item.timestamp > this.ttl) {
      this.cache.delete(key);
      return null;
    }
    
    return item.data;
  }

  // 設置緩存
  set(fact: string, sources: Source[], data: any): void {
    if (!fact) return;
    const key = this.generateKey(fact, sources);
    
    // 如果緩存已滿，刪除最舊的條目
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }
    
    this.cache.set(key, { data, timestamp: Date.now() });
  }

  // 清理過期緩存
  cleanup(): void {
    const now = Date.now();
    for (const [key, item] of this.cache.entries()) {
      if (now - item.timestamp > this.ttl) {
        this.cache.delete(key);
      }
    }
  }

  // 獲取緩存統計
  getStats(): { size: number; maxSize: number; hitRate: number } {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hitRate: 0 // 可以擴展為實際命中率統計
    };
  }
}

// 並行處理器
export class ParallelProcessor {
  private maxConcurrent: number;
  private running = 0;
  private queue: Array<() => Promise<any>> = [];

  constructor(maxConcurrent: number) {
    this.maxConcurrent = maxConcurrent;
  }

  // 添加任務到隊列
  async add<T>(task: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const wrappedTask = async () => {
        try {
          this.running++;
          const result = await task();
          resolve(result);
        } catch (error) {
          reject(error);
        } finally {
          this.running--;
          this.processQueue();
        }
      };

      if (this.running < this.maxConcurrent) {
        wrappedTask();
      } else {
        this.queue.push(wrappedTask);
      }
    });
  }

  // 處理隊列中的任務
  private processQueue(): void {
    while (this.queue.length > 0 && this.running < this.maxConcurrent) {
      const task = this.queue.shift();
      if (task) task();
    }
  }

  // 批量處理任務
  async processBatch<T>(tasks: Array<() => Promise<T>>, batchSize: number = 3): Promise<T[]> {
    const results: T[] = [];
    
    for (let i = 0; i < tasks.length; i += batchSize) {
      const batch = tasks.slice(i, i + batchSize);
      const batchResults = await Promise.all(batch.map(task => this.add(task)));
      results.push(...batchResults);
    }
    
    return results;
  }

  // 獲取當前狀態
  getStatus(): { running: number; queueLength: number; maxConcurrent: number } {
    return {
      running: this.running,
      queueLength: this.queue.length,
      maxConcurrent: this.maxConcurrent
    };
  }
}
