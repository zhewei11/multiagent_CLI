<!--
File: src/App.vue
Implements the core features from app.ts (Router → Researcher → Analyst → Writer → FactChecker → Critic)
with a streaming UI. Includes a local MockService for quick demo without backend.
-->
<template>
  <div class="app">
    <header class="topbar">
      <h1>🧠 Multi-Agent Q&A</h1>
      <div class="spacer" />
      <!-- 主題切換 -->
      <button
        class="btn"
        @click="toggleTheme"
        :aria-pressed="theme === 'dark'"
        :title="theme === 'dark' ? '切換為淺色模式' : '切換為深色模式'"
      >
        {{ theme === 'dark' ? '🌙' : '☀️' }}
      </button>
      <button class="btn" @click="toggleSettings">⚙️ 設定</button>
    </header>

    <section class="controls">
      <input v-model="question" class="input" type="text" placeholder="輸入你的問題… (支援中/英)" @keyup.enter="run" />
      <button class="btn primary" :disabled="running || !question.trim()" @click="run">{{ running ? '執行中…' : '送出' }}</button>
    </section>

    <section v-if="plan" class="panel">
      <h2>📋 路由規劃</h2>
      <div class="grid two">
        <div>
          <div><b>useWeb:</b> {{ plan.useWeb ? '是' : '否' }}</div>
          <div><b>topic:</b> {{ plan.topic }}</div>
          <div><b>maxIterations:</b> {{ plan.maxIterations }}</div>
        </div>
        <div>
          <b>steps:</b>
          <ul class="steps">
            <li v-for="s in plan.steps" :key="s">{{ s }}</li>
          </ul>
        </div>
      </div>
    </section>

    <section v-if="research.sources.length" class="panel">
      <h2>🔎 研究來源</h2>
      <ul class="sources">
        <li v-for="(s, i) in research.sources" :key="i">
          <a :href="s.url" target="_blank" rel="noopener">{{ s.title || s.url }}</a>
          <small> — {{ s.published || 'n/a' }}|{{ hostname(s.url) }}</small>
          <div class="snippet">{{ s.snippet }}</div>
        </li>
      </ul>
    </section>

    <section v-if="research.facts.length" class="panel">
      <h2>📚 核心事實 (可引用)</h2>
      <ol>
        <li v-for="(f, i) in research.facts" :key="i">
          <div class="fact">{{ f.statement }}</div>
          <div class="meta">
            <a :href="f.source" target="_blank" rel="noopener">來源</a>
            <span v-if="f.published">|{{ f.published }}</span>
          </div>
        </li>
      </ol>
    </section>

    <section class="panel">
      <h2>✍️ 產生回答</h2>
      <div class="answer" v-html="writerHtml"></div>
      <div v-if="running && !finalized" class="muted">（串流輸出中…）</div>
    </section>

    <section v-if="factReport" class="panel">
      <h2>🧪 事實查核</h2>
      <div class="fc-grid">
        <div>
          <table class="table">
            <thead>
              <tr><th>#</th><th>Claim</th><th>Verdict</th></tr>
            </thead>
            <tbody>
              <tr v-for="(c, idx) in factReport.claims" :key="idx">
                <td>{{ idx + 1 }}</td>
                <td>{{ c.text }}</td>
                <td><span :class="['badge', c.verdict.toLowerCase()]">{{ c.verdict }}</span></td>
              </tr>
            </tbody>
          </table>
        </div>
        <pre class="summary" v-if="factReport.summary">{{ factReport.summary }}</pre>
      </div>
    </section>

    <section v-if="tokens.total" class="panel">
      <h2>⏱️ Token 用量</h2>
      <div class="grid three">
        <div><b>Prompt:</b> {{ tokens.prompt }}</div>
        <div><b>Completion:</b> {{ tokens.completion }}</div>
        <div><b>Total:</b> {{ tokens.total }}</div>
      </div>
    </section>

    <footer class="footer">
      <button class="btn" @click="resetAll" :disabled="running">清空</button>
      <span class="muted">速度：{{ settings.speedMode }}｜語言：{{ settings.lang }}｜Web：{{ settings.useWeb ? '開' : '關' }}</span>
    </footer>

    <!-- 設定抽屜 -->
    <div class="drawer" :class="{ open: showSettings }">
      <div class="drawer-inner">
        <h3>⚙️ 執行設定</h3>
        <label class="row">
          <span>速度模式</span>
          <select v-model="settings.speedMode">
            <option value="fast">fast</option>
            <option value="balanced">balanced</option>
            <option value="thorough">thorough</option>
          </select>
        </label>
        <label class="row">
          <span>輸出語言</span>
          <select v-model="settings.lang">
            <option value="auto">auto</option>
            <option value="en">en</option>
            <option value="zh-TW">zh-TW</option>
            <option value="ja">ja</option>
            <option value="ko">ko</option>
          </select>
        </label>
        <label class="row"><span>使用 Web 搜尋</span><input type="checkbox" v-model="settings.useWeb" /></label>
        <label class="row"><span>時間上限 (秒)</span><input type="number" min="0" v-model.number="settings.timeLimitSec" /></label>
        <label class="row"><span>最少英語來源</span><input type="number" min="0" v-model.number="settings.minEnSources" /></label>
        <label class="row"><span>每站最大筆數</span><input type="number" min="1" v-model.number="settings.maxPerDomain" /></label>
        <label class="row"><span>查詢擴展</span><input type="checkbox" v-model="settings.queryExpansion" /></label>
        <div class="hr" />
        <label class="row"><span>Demo 模式（前端模擬）</span><input type="checkbox" v-model="settings.demoMode" /></label>
        <p class="muted">※ 正式使用請關閉 Demo 模式並配置後端 API（見下方註解）。</p>
        <button class="btn" @click="toggleSettings">關閉</button>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { computed, reactive, ref, onMounted } from 'vue';

/* -------------------------------- Theme -------------------------------- */
type Theme = 'dark' | 'light';
const THEME_KEY = 'theme';
const theme = ref<Theme>('dark');

function applyTheme(t: Theme, persist = false) {
  theme.value = t;
  document.documentElement.setAttribute('data-theme', t);
  if (persist) localStorage.setItem(THEME_KEY, t);
}

function toggleTheme() {
  applyTheme(theme.value === 'dark' ? 'light' : 'dark', true);
}

onMounted(() => {
  const saved = (localStorage.getItem(THEME_KEY) as Theme | null);
  const systemDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true;
  applyTheme(saved ?? (systemDark ? 'dark' : 'light'));
});

/* -------------------------------- Types -------------------------------- */
interface Source { title?: string; url: string; snippet?: string; published?: string }
interface Fact { statement: string; source: string; evidence?: string; published?: string }
interface ResearchBundle { id: string; query: string; sources: Source[]; facts: Fact[] }
interface RouterPlan { useWeb: boolean; topic: 'general' | 'news'; steps: string[]; maxIterations: number }
interface FactCheckItem { text: string; verdict: 'SUPPORTED' | 'WEAK' | 'NO_EVIDENCE' | 'CONTRADICTED' }
interface FactCheckReport { claims: FactCheckItem[]; summary?: string }
interface TokenUsage { prompt: number; completion: number; total: number }

/* ------------------------------ Local State ---------------------------- */
const question = ref('');
const running = ref(false);
const finalized = ref(false);
const plan = ref<RouterPlan | null>(null);
const research = reactive<ResearchBundle>({ id: '', query: '', sources: [], facts: [] });
const writerChunks = ref<string>('');
const factReport = ref<FactCheckReport | null>(null);
const tokens = reactive<TokenUsage>({ prompt: 0, completion: 0, total: 0 });

const showSettings = ref(false);
const settings = reactive({
  speedMode: 'balanced' as 'fast' | 'balanced' | 'thorough',
  lang: 'auto' as 'auto' | 'en' | 'zh-TW' | 'ja' | 'ko',
  useWeb: true,
  timeLimitSec: 30,
  minEnSources: 3,
  maxPerDomain: 2,
  queryExpansion: true,
  demoMode: false, // 預設關閉 Demo（無需後端）。要串接後端請改為 false。
});
onMounted(async () => {
  try {
    const res = await fetch('/api/config');
    if (res.ok) {
      const cfg = await res.json();
      if (cfg?.targetLang) settings.lang = cfg.targetLang;
      if (cfg?.speedMode) settings.speedMode = cfg.speedMode;
      if (typeof cfg?.maxTimeMs === 'number') settings.timeLimitSec = Math.max(0, Math.round(cfg.maxTimeMs / 1000));
      if (typeof cfg?.minEnSources === 'number') settings.minEnSources = cfg.minEnSources;
      if (typeof cfg?.maxPerDomain === 'number') settings.maxPerDomain = cfg.maxPerDomain;
      if (typeof cfg?.queryExpansion === 'boolean') settings.queryExpansion = cfg.queryExpansion;
    }
  } catch (err) {
    console.warn('[config] failed to load /api/config:', err);
  }
});


function toggleSettings() { showSettings.value = !showSettings.value; }
function resetAll() {
  plan.value = null; research.id = ''; research.query = ''; research.sources = []; research.facts = [];
  writerChunks.value = ''; factReport.value = null; tokens.prompt = tokens.completion = tokens.total = 0;
  finalized.value = false; question.value = '';
}
function hostname(u: string) { try { return new URL(u).hostname; } catch { return '' } }

const writerHtml = computed(() => writerChunks.value
  .replace(/\n/g, '<br/>')
  .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
  .replace(/`{3}([^`]+)`{3}/g, '<pre>$1</pre>')
);

/* ------------------------------ Runner Core ---------------------------- */
async function run() {
  if (!question.value.trim() || running.value) return;
  running.value = true; finalized.value = false; writerChunks.value = ''; factReport.value = null; plan.value = null;
  research.id = ''; research.query = ''; research.sources = []; research.facts = [];
  tokens.prompt = tokens.completion = tokens.total = 0;

  try {
    if (settings.demoMode) {
      await MockService.run({
        question: question.value,
        settings,
        onPlan: p => plan.value = p,
        onResearch: b => Object.assign(research, b),
        onWriterChunk: c => writerChunks.value += c,
        onFactReport: r => factReport.value = r,
        onTokens: t => Object.assign(tokens, t),
        onDone: () => { finalized.value = true; running.value = false; },
      });
    } else {
      await callBackend({
        question: question.value,
        settings,
        onPlan: p => plan.value = p,
        onResearch: b => Object.assign(research, b),
        onWriterChunk: c => writerChunks.value += c,
        onFactReport: r => factReport.value = r,
        onTokens: t => Object.assign(tokens, t),
        onDone: () => { finalized.value = true; running.value = false; },
      });
    }
  } catch (e) {
    console.error(e);
    alert('執行失敗：' + (e as Error).message);
    running.value = false;
  }
}

/* ------------------------------ Backend API (SSE) ------------------------------
  建議後端提供 SSE 端點：POST /api/chat → 以 text/event-stream 回傳多事件：
  event: plan        data: RouterPlan
  event: research    data: ResearchBundle
  event: writer      data: { chunk: string }
  event: factcheck   data: FactCheckReport
  event: tokens      data: TokenUsage
  event: done        data: {}
  你可將 app.ts 拆成 core 模組後，在路由中逐步 emit 事件。
------------------------------------------------------------------------------ */
async function callBackend(opts: {
  question: string;
  settings: typeof settings;
  onPlan: (p: any) => void;
  onResearch: (b: any) => void;
  onWriterChunk: (s: string) => void;
  onFactReport: (r: any) => void;
  onTokens: (t: any) => void;
  onDone: () => void;
}) {
  const params = new URLSearchParams({
    question: opts.question,
    speedMode: settings.speedMode,
    lang: settings.lang,
    useWeb: String(settings.useWeb),
    timeLimitMs: String(Math.max(0, settings.timeLimitSec * 1000) || 0),
    minEnSources: String(settings.minEnSources),
    maxPerDomain: String(settings.maxPerDomain),
    queryExpansion: String(settings.queryExpansion),
  });

  const url = `/api/chat?${params.toString()}`;
  const es = new EventSource(url);

  es.addEventListener('plan', (e: MessageEvent) => { opts.onPlan(JSON.parse(e.data)); });
  es.addEventListener('research', (e: MessageEvent) => { opts.onResearch(JSON.parse(e.data)); });
  es.addEventListener('writer', (e: MessageEvent) => {
    const d = JSON.parse(e.data);
    opts.onWriterChunk(d.chunk || '');
  });
  es.addEventListener('factcheck', (e: MessageEvent) => { opts.onFactReport(JSON.parse(e.data)); });
  es.addEventListener('tokens', (e: MessageEvent) => { opts.onTokens(JSON.parse(e.data)); });
  es.addEventListener('done', () => { es.close(); opts.onDone(); });
  es.addEventListener('error', (_e) => { /* 可加自動重試策略 */ });
}

function parseSSE(chunk: string): { event: string; data: string } | null {
  const lines = chunk.split('\n');
  let event = 'message';
  const dataLines: string[] = [];
  for (const l of lines) {
    if (l.startsWith('event:')) event = l.slice(6).trim();
    if (l.startsWith('data:')) dataLines.push(l.slice(5).trim());
  }
  if (!dataLines.length) return null;
  return { event, data: dataLines.join('\n') };
}

/* ------------------------------ Mock Service ------------------------------ */
const MockService = {
  async run(opts: {
    question: string;
    settings: typeof settings;
    onPlan: (p: RouterPlan) => void;
    onResearch: (b: ResearchBundle) => void;
    onWriterChunk: (s: string) => void;
    onFactReport: (r: FactCheckReport) => void;
    onTokens: (t: TokenUsage) => void;
    onDone: () => void;
  }) {
    // 1) Plan
    const plan: RouterPlan = {
      useWeb: opts.settings.useWeb,
      topic: /latest|news|今天|最新/i.test(opts.question) ? 'news' : 'general',
      steps: ['Researcher','Analyst','Writer', ...(opts.settings.speedMode !== 'fast' ? ['FactChecker'] : []), 'Critic'],
      maxIterations: opts.settings.speedMode === 'thorough' ? 2 : 1,
    };
    opts.onPlan(plan);
    await delay(400);

    // 2) Research
    const bundle: ResearchBundle = {
      id: Math.random().toString(36).slice(2),
      query: opts.question,
      sources: [
        { title: 'Example Source A', url: 'https://example.com/a', snippet: 'A short abstract about topic A.', published: '2025-08-01' },
        { title: 'Example Source B', url: 'https://example.com/b', snippet: 'Some details relevant to the question.', published: '2025-07-28' },
        { title: 'Example Source C', url: 'https://example.com/c', snippet: 'Background and definitions.', published: '2025-07-15' },
      ],
      facts: [
        { statement: 'Fact #1 from Source A', source: 'https://example.com/a', published: '2025-08-01' },
        { statement: 'Fact #2 from Source B', source: 'https://example.com/b', published: '2025-07-28' },
      ],
    };
    opts.onResearch(bundle);
    await delay(300);

    // 3) Writer (streaming)
    const chunks = [
      '## 摘要\n這裡是重點整理，說明你的問題與結論。\n\n',
      '## 完整解答\n分步驟說明、比較、附上資料來源引用…\n',
      '## 侷限與反例\n針對尚不確定的部分進行保留。\n',
      '## 檢查清單\n- 步驟 1\n- 步驟 2\n- 步驟 3\n',
      '## 參考來源\n- example.com/a\n- example.com/b\n',
    ];
    for (const c of chunks) { opts.onWriterChunk(c); await delay(260); }

    // 4) Fact-checker
    if (plan.steps.includes('FactChecker')) {
      const report: FactCheckReport = {
        claims: [
          { text: 'Claim A is accurate.', verdict: 'SUPPORTED' },
          { text: 'Claim B has weak evidence.', verdict: 'WEAK' },
          { text: 'Claim C contradicts source B.', verdict: 'CONTRADICTED' },
        ],
        summary: '總結：主要結論可被支持，部分細節應弱化描述或移除。',
      };
      opts.onFactReport(report);
      await delay(200);
    }

    // 5) Tokens
    opts.onTokens({ prompt: 1432, completion: 987, total: 2419 });

    // 6) Done
    await delay(100);
    opts.onDone();
  }
};

function delay(ms: number) { return new Promise(res => setTimeout(res, ms)); }
</script>

<!-- 全域變數：不加 scoped，讓 :root 真的掛在文件根節點 -->
<style>
/* 既有的：預設深色主題 */
:root{
  --bg:#0b0c10;
  --panel:#11141a;
  --text:#e8e8e8;
  --muted:#9aa4b2;
  --accent:#5cc8ff;
  --green:#33d69f;
  --yellow:#ffd166;
  --red:#ff6b6b;

  /* 新增：表層用色（便於多主題覆寫） */
  --surface:#0e1117;    /* input / 控件底 */
  --button:#1a1f2b;     /* 一般按鈕底 */
  --overlay:#0f1219;    /* 抽屜面板底 */
  --border:#2a3140;     /* 邊框色 */

  color-scheme: dark light; /* 告知瀏覽器支援雙主題（表單、選單等原生控件會跟著變） */
}
html[data-theme="dark"]  { color-scheme: dark; }
html[data-theme="light"] { color-scheme: light; }

/* 新增：淺色主題（以 data-theme 切換） */
html[data-theme="light"]{
  --bg:#f5f7fb;
  --panel:#ffffff;
  --text:#111827;
  --muted:#667085;
  --accent:#1e90ff;
  --green:#10b981;
  --yellow:#f59e0b;
  --red:#ef4444;

  --surface:#f8fafc;
  --button:#eef2f7;
  --overlay:#ffffff;
  --border:#d9e0ea;
}

/* （可選）切換時的平滑過渡 */
.app, .topbar, .controls, .panel, .input, .btn, .drawer, .drawer-inner, .footer, .table th, .table td {
  transition: background-color .2s ease, color .2s ease, border-color .2s ease;
}
</style>

<!-- 元件樣式：保留 scoped（移除了原本的 :root 區塊） -->
<style scoped>
* { box-sizing: border-box; }
body, html, #app, .app { height: 100%; margin:0; }
.app { background: var(--bg); color: var(--text); font: 15px/1.55 ui-sans-serif, system-ui; }

/* Topbar：改用主題色並提供透明度（含 fallback） */
.topbar {
  display:flex; align-items:center; padding:12px 16px;
  border-bottom:1px solid var(--border);
  position: sticky; top:0;
  background: var(--bg);
  background: color-mix(in srgb, var(--bg) 90%, transparent);
  backdrop-filter: blur(6px);
}
.topbar h1 { font-size: 18px; margin:0; }
.spacer { flex:1; }

.controls { display:flex; gap:8px; padding:14px 16px; border-bottom:1px solid var(--border); }
.input {
  flex:1; padding:10px 12px; border-radius:10px;
  border:1px solid var(--border);
  background: var(--surface); color:var(--text);
}

.btn {
  padding:8px 12px; border-radius:10px;
  background: var(--button); color:var(--text);
  border:1px solid var(--border); cursor:pointer;
}
.btn.primary { background: #1a2a3d; border-color:#294a6b; color:#dcefff; }
.btn:disabled { opacity:0.6; cursor:not-allowed; }

.panel {
  margin:16px; padding:16px; background: var(--panel);
  border:1px solid var(--border); border-radius:14px;
}

.grid.two { display:grid; grid-template-columns: 1fr 1fr; gap:12px; }
.grid.three { display:grid; grid-template-columns: repeat(3,1fr); gap:12px; }

.steps { margin:6px 0 0 0; padding-left:18px; }
.sources { list-style:none; padding:0; margin:0; }
.sources li { padding:10px 0; border-bottom:1px dashed var(--border); }
.sources a { color: var(--accent); text-decoration: none; }
.snippet { color: var(--muted); margin-top:4px; }

.answer { white-space: normal; line-height: 1.75; }
.muted { color: var(--muted); }

.table { width:100%; border-collapse: collapse; }
.table th, .table td { text-align:left; padding:8px; border-bottom:1px solid var(--border); }

.badge { padding:2px 8px; border-radius:999px; font-size:12px; border:1px solid var(--border); }
.badge.supported { color: var(--green); border-color: #1f3a33; }
.badge.weak { color: var(--yellow); border-color: #3a331f; }
.badge.no_evidence { color: var(--yellow); border-color: #3a331f; }
.badge.contradicted { color: var(--red); border-color: #3a1f1f; }

.footer { display:flex; align-items:center; gap:10px; padding:14px 16px; border-top:1px solid var(--border); }

/* Drawer */
.drawer { position: fixed; right:0; top:0; bottom:0; width: 0; overflow:hidden; background: rgba(0,0,0,0.4); transition: width .2s ease; }
.drawer.open { width: 100%; }
.drawer-inner {
  position: absolute; right:0; top:0; bottom:0; width: 360px;
  background: var(--overlay);
  border-left:1px solid var(--border);
  padding:16px;
}
.row { display:flex; align-items:center; justify-content: space-between; padding:8px 0; gap:10px; }
.row input[type="number"], .row select {
  width: 140px; padding:6px 8px; border-radius:8px;
  background: var(--surface); color:var(--text); border:1px solid var(--border);
}
.hr { border-top:1px solid var(--border); margin:10px 0; }
</style>
