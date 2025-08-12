# Multi-Agent Q&A（Vue + SSE）

一個以 **Vue 3 前端 + Express 後端（SSE）** 串流回答的多代理（Researcher / Analyst / Writer / FactChecker / Critic）問答系統。  
支援以 **Tavily** 進行網路檢索（可選）、事實查核（非 fast 模式）、多語輸出與 Token 統計。

> 預設 **Demo 模式為關閉**，啟動後端 `/api/chat` 才會工作；事實查核區塊在回答完成前為空白屬正常行為。前端「產生回答」視窗的輸出內文維持固定中文。

---

## 目錄
- [功能總覽](#功能總覽)
- [專案結構](#專案結構)
- [需求與安裝](#需求與安裝)
- [環境變數](#環境變數)
- [本機開發](#本機開發)
- [正式部署](#正式部署)
- [前端設定](#前端設定)
- [後端 API（SSE）](#後端-apisse)
- [疑難排解](#疑難排解)

---

## 功能總覽
- ✅ **多代理流程**：Router 規劃 → Researcher 檢索 → Analyst 萃取事實 → Writer 串流輸出 → FactChecker → Critic  
- ✅ **SSE 串流** 回傳：逐 token（chunk）輸出，體驗順暢  
- ✅ **可選網路檢索**：Tavily API（無金鑰時自動跳過）  
- ✅ **事實查核**：生成 claims 與摘要（在 balanced / thorough 模式啟用）  
- ✅ **多語輸出**：`auto / en / zh-TW / ja / ko`  
- ✅ **Token 使用量**：提示詞/補全/總數統計  
- ✅ **可調參數**：速度模式、時間上限、來源數量/網域上限、查詢展開等

---

## 專案結構
Monorepo（npm workspaces）：
```
apps/
  server/   ← Express 後端（SSE / 靜態檔托管）
  web/      ← Vue 3 前端（單頁）
packages/
  core/     ← 多代理核心（@multi/core）
```

根目錄 scripts（節錄）：
- `npm run dev`：同時啟動 core / server / web（開發模式，watch）
- `npm run build`：依序建置 core → server → web
- `npm start`：啟動已建置的後端（production）

---

## 需求與安裝
- Node.js **>= 20**
- npm **>= 9**

```bash
# 1) 安裝相依
npm i

# 2) 建立 .env（見下方環境變數區）
cp .env.example .env  # 若你喜歡，可自行建立一份

# 3) 開發模式（同時啟動 core / server / web）
npm run dev
```

---

## 環境變數
在 **專案根目錄** 放一份 `.env`（後端也會載入根目錄 .env；如需分離，可另放 `apps/server/.env`）。

**必要**
```ini
# OpenAI
OPENAI_API_KEY=sk-...

# 可選：Tavily（啟用網路檢索）
TAVILY_API_KEY=tvly-...
```

**後端伺服器（可選，具預設值）**
```ini
# 後端 Port
PORT=8787

# 預設輸出語言：auto | en | zh-TW | ja | ko
TARGET_LANG=auto

# 速度模式：fast | balanced | thorough
SPEED_MODE=balanced

# 單次回答的時間上限（毫秒，空或 <=0 表示不限）
MAX_TIME_MS=30000

# 來源最少英文數、每網域上限、是否展開查詢
MIN_EN_SOURCES=3
MAX_PER_DOMAIN=2
QUERY_EXPANSION=1   # 1:開啟, 0:關閉
```

**核心行為（可選）**
```ini
# 模型
WRITER_MODEL=gpt-4o-mini
RESEARCH_MODEL=gpt-4o-mini
CRITIC_MODEL=gpt-4o-mini
ROUTER_MODEL=gpt-4o-mini
EMBED_MODEL=text-embedding-3-small

# 各代理溫度/限制
WRITER_TEMPERATURE=0.7
WRITER_MAX_TOKENS=1800
RESEARCH_TEMPERATURE=0.2
ANALYST_TEMPERATURE=0.2
CRITIC_TEMPERATURE=0.3

# 搜尋/快取/新聞視窗
SEARCH_MAX_RESULTS=10
FACTCHECK_CLAIMS=4
FACTCHECK_PER_CLAIM_SOURCES=6
CACHE_TTL_MS=600000
NEWS_DAYS=7
SEARCH_PARALLEL_NEWS=1

# 其他
MEMORY_PATH=./memory.jsonl
```

> 註：未提供 `TAVILY_API_KEY` 時，系統會自動略過網路檢索（仍可離線回答）。

---

## 本機開發
```bash
# 啟動三個服務（core / server / web）
npm run dev
```
- 前端預設會在 UI 設定面板看到「Demo 模式」切換項。**預設為關閉**，即使用後端 `/api/chat`。  
- 後端啟動後，預設在 `http://localhost:8787` 監聽。  
- 前端啟動的開發伺服器網址請以終端機輸出為準（一般為 Vite 的 5173）。

---

## 正式部署
```bash
# 建置所有套件
npm run build

# 以 production 模式啟動後端（會同站托管 web/dist）
NODE_ENV=production npm start
# → 伺服器會將 web/dist 設為靜態檔目錄，並回傳 index.html 做 SPA fallback
```

**反向代理（Nginx）建議**
- 關閉緩衝避免 SSE 被延遲：`proxy_no_cache 1; proxy_buffering off;`
- 轉送頭：`X-Accel-Buffering: no`（程式已送出）

---

## 前端設定
前端可透過 `/api/config` 取得後端預設：
```json
{
  "targetLang": "auto",
  "speedMode": "balanced",
  "maxTimeMs": 30000,
  "minEnSources": 3,
  "maxPerDomain": 2,
  "queryExpansion": true
}
```

UI 可切換：
- **速度模式**：`fast`（不跑 FactChecker、最快）、`balanced`、`thorough`（更完整）
- **語言**：`auto / en / zh-TW / ja / ko`
- **是否使用網路**：`useWeb`
- **時間上限**：秒（對應後端 `timeLimitMs`）
- **來源限制**：`minEnSources / maxPerDomain`
- **查詢展開**：`queryExpansion`

> 小提醒：**FactChecker 僅在非 `fast` 模式**執行，因此在 `fast` 模式下「事實查核」區塊為空是正常的。

---

## 後端 API（SSE）
### 1) 取得後端預設
```
GET /api/config
```
回傳欄位如上（前端會用來初始化 UI 預設值）。

### 2) 啟動問答（SSE 串流）
```
GET /api/chat?question=...&lang=...&speedMode=...&useWeb=...&timeLimitMs=...&minEnSources=...&maxPerDomain=...&queryExpansion=...
Content-Type: text/event-stream
```

**Query 參數**
- `question`（必填）：問題文字
- `lang`：`auto | en | zh-TW | ja | ko`（預設取後端 TARGET_LANG）
- `speedMode`：`fast | balanced | thorough`（預設取後端 SPEED_MODE）
- `useWeb`：`true | false`
- `timeLimitMs`：整數毫秒（不填則採後端 `MAX_TIME_MS`）
- `minEnSources`、`maxPerDomain`、`queryExpansion`：數值/布林（不填則採後端預設）

**SSE 事件流（依序/交錯出現）**
- `plan`：`{ useWeb, topic, steps, maxIterations }`
- `research`：`{ id, query, sources[], facts[] }`
- `writer`：`{ chunk: string }`（**多次**出現，前端需串接）
- `factcheck`：`{ claims[], summary? }`（僅非 `fast` 模式）
- `tokens`：`{ prompt, completion, total }`
- `error`：`{ message }`
- `done`：`{}`（串流結束）

**cURL 範例**
```bash
curl -N "http://localhost:8787/api/chat?question=台灣近一週半導體重要新聞重點&lang=zh-TW&speedMode=balanced&useWeb=true&timeLimitMs=30000"
```

**前端 EventSource 範例**
```ts
const params = new URLSearchParams({
  question: 'Explain RLHF vs. DPO',
  lang: 'en',
  speedMode: 'balanced',
  useWeb: 'true',
  timeLimitMs: '30000',
  minEnSources: '3',
  maxPerDomain: '2',
  queryExpansion: 'true',
});
const es = new EventSource(`/api/chat?${params.toString()}`);
es.addEventListener('plan',     e => console.log('plan', JSON.parse(e.data)));
es.addEventListener('research', e => console.log('research', JSON.parse(e.data)));
es.addEventListener('writer',   e => processChunk(JSON.parse(e.data).chunk));
es.addEventListener('factcheck',e => console.log('fact', JSON.parse(e.data)));
es.addEventListener('tokens',   e => console.log('tokens', JSON.parse(e.data)));
es.addEventListener('error',    e => console.error('error', e));
es.addEventListener('done',     () => es.close());
```

---

## 疑難排解
- **沒有串流/很慢**：反向代理需關閉緩衝（見上方 Nginx 建議）；確保回應標頭含 `Content-Type: text/event-stream` 與 `X-Accel-Buffering: no`。  
- **401/金鑰錯誤**：確認 `OPENAI_API_KEY`（必要）已設定；`TAVILY_API_KEY` 可選。  
- **CORS 問題**：後端已啟用 `cors()`，若有自訂網域/代理，請比對前端請求來源。  
- **事實查核沒出現**：確認 `speedMode` 不是 `fast`。  
- **無網路檢索來源**：未設 `TAVILY_API_KEY` 或查無資料時屬正常，系統仍可生成回答。  
- **部署後前端白頁**：請以 `NODE_ENV=production npm start` 啟動，後端才會同站托管 `web/dist`。  
