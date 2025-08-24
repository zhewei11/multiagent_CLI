// apps/server/src/index.ts
import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ResearchPipeline, Settings } from '@multi/core';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 修复环境变量加载问题
// 按优先级顺序加载：1. 项目根目录 .env, 2. server目录 .env, 3. 系统环境变量
const rootEnvPath = path.resolve(__dirname, '../../../.env');
const serverEnvPath = path.resolve(__dirname, '../.env');

console.log('[server] 环境变量加载路径:');
console.log(`  - 项目根目录: ${rootEnvPath}`);
console.log(`  - Server目录: ${serverEnvPath}`);

// 先加载项目根目录的 .env
dotenv.config({ path: rootEnvPath });
console.log(`[server] 根目录 .env 加载状态: ${process.env.OPENAI_API_KEY ? '成功' : '失败'}`);

// 再加载 server 目录的 .env（会覆盖根目录的配置）
dotenv.config({ path: serverEnvPath });
console.log(`[server] Server目录 .env 加载状态: ${process.env.OPENAI_API_KEY ? '成功' : '失败'}`);

// 检查必要环境变量
if (!process.env.OPENAI_API_KEY) {
  console.error('[server] ❌ 缺少 OPENAI_API_KEY: 系统无法正常工作');
  process.exit(1);
}

if (!process.env.TAVILY_API_KEY) {
  console.warn('[server] ⚠️ 缺少 TAVILY_API_KEY: Web 搜索功能将被禁用');
  console.warn('[server] 请在 .env 文件中添加 TAVILY_API_KEY=tvly-...');
} else {
  console.log('[server] ✅ TAVILY_API_KEY 配置成功，Web 搜索功能已启用');
}

const app = express();
app.use(cors());
app.use(express.json());

// ---- 後端預設值（可被 query 覆蓋） ----
const DEF = {
  TARGET_LANG: (process.env.TARGET_LANG ?? 'auto') as Settings['lang'],
  SPEED_MODE: (process.env.SPEED_MODE ?? 'balanced') as Settings['speedMode'],
  MAX_TIME_MS: (() => {
    const n = Number(process.env.MAX_TIME_MS ?? '0');
    return Number.isFinite(n) && n > 0 ? n : null;
  })(),
  MIN_EN_SOURCES: Number(process.env.MIN_EN_SOURCES ?? '3'),
  MAX_PER_DOMAIN: Number(process.env.MAX_PER_DOMAIN ?? '2'),
  QUERY_EXPANSION: (process.env.QUERY_EXPANSION ?? '1') !== '0',
};

// 提供前端取用的預設
app.get('/api/config', (_req: Request, res: Response) => {
  res.json({
    targetLang: DEF.TARGET_LANG,
    speedMode: DEF.SPEED_MODE,
    maxTimeMs: DEF.MAX_TIME_MS,
    minEnSources: DEF.MIN_EN_SOURCES,
    maxPerDomain: DEF.MAX_PER_DOMAIN,
    queryExpansion: DEF.QUERY_EXPANSION,
  });
});

// SSE：主執行端點
app.get('/api/chat', async (req: Request, res: Response) => {
  const question = String(req.query.question ?? '').trim();
  if (!question) return res.status(400).end('missing question');

  // 解析設定（允許被 query 覆蓋；否則 fallback 到 .env 預設）
  const allowedLang = new Set<Settings['lang']>(['auto','en','zh-TW','ja','ko']);
  const rawLang = String(req.query.lang ?? DEF.TARGET_LANG).trim() as Settings['lang'];
  const lang = allowedLang.has(rawLang) ? rawLang : DEF.TARGET_LANG;

  const rawSpeed = String(req.query.speedMode ?? DEF.SPEED_MODE);
  const speedMode = (['fast','balanced','thorough'].includes(rawSpeed) ? rawSpeed : DEF.SPEED_MODE) as Settings['speedMode'];

  const settings: Settings = {
    speedMode,
    lang,
    useWeb: String(req.query.useWeb ?? 'true') === 'true',
    timeLimitMs: req.query.timeLimitMs ? Number(req.query.timeLimitMs) : DEF.MAX_TIME_MS,
    minEnSources: req.query.minEnSources ? Number(req.query.minEnSources) : DEF.MIN_EN_SOURCES,
    maxPerDomain: req.query.maxPerDomain ? Number(req.query.maxPerDomain) : DEF.MAX_PER_DOMAIN,
    queryExpansion: req.query.queryExpansion != null ? String(req.query.queryExpansion) === 'true' : DEF.QUERY_EXPANSION,
  };

  // 設定 SSE header
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // for nginx

  const send = (event: string, data: any) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // 心跳避免連線被中斷
  const keepalive = setInterval(() => res.write(': keepalive\n\n'), 15000);
  const ac = new AbortController();
  req.on('close', () => { clearInterval(keepalive); ac.abort(); });

  try {
    const pipeline = new ResearchPipeline();
    await pipeline.runPipeline(question, settings, (ev: string, payload: any) => send(ev, payload));
  } catch (err: any) {
    console.error('[pipeline] failed:', err);
    send('error', { message: err?.message || 'unknown error' });
  } finally {
    clearInterval(keepalive);
    send('done', {});
    res.end();
  }
});

// 靜態檔托管（production 模式）
if (process.env.NODE_ENV === 'production') {
  const distPath = path.resolve(__dirname, '../web/dist');
  app.use(express.static(distPath));
  
  // SPA fallback
  app.get('*', (_req: Request, res: Response) => res.sendFile(path.join(distPath, 'index.html')));
}

const port = process.env.PORT || 8787;
app.listen(port, () => {
  console.log(`[server] Listening on http://localhost:${port}`);
  if (process.env.NODE_ENV === 'production') {
    console.log(`[server] Serving static files from ${path.resolve(__dirname, '../web/dist')}`);
  }
});
