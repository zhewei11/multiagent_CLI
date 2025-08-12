// apps/server/src/index.ts
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPipeline, Settings } from '@multi/core';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 讀取 .env（先嘗試 server/.env，再嘗試專案根目錄 .env）
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

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
app.get('/api/config', (_req, res) => {
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
app.get('/api/chat', async (req, res) => {
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
    await runPipeline({
      question,
      settings,
      emit: (ev, payload) => send(ev, payload),
      signal: ac.signal,
    });
  } catch (err: any) {
    console.error('[pipeline] failed:', err);
    send('error', { message: err?.message || 'unknown error' });
  } finally {
    clearInterval(keepalive);
    send('done', {});
    res.end();
  }
});

// 部署時（可選）：同站服務前端打包檔
if (process.env.NODE_ENV === 'production') {
  const distPath = path.resolve(__dirname, '../../web/dist');
  app.use(express.static(distPath));
  app.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
}

const PORT = Number(process.env.PORT ?? 8787);
app.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
});
