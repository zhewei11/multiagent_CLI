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
      
      <!-- 新增：顯示問題的 token 數 -->
      <div v-if="question.trim()" class="question-tokens">
        <span class="token-info">
          預估 API Token 數: <strong>{{ questionTokenCount }}</strong>
          <small>(問題本身)</small>
        </span>
        <div class="token-note">
          <small>💡 實際 API 調用會包含系統提示詞，總 token 數會更高</small>
        </div>
      </div>
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

    <!-- 調試信息面板 -->
    <section class="panel debug-panel">
      <h2>🐛 調試信息</h2>
      <div class="debug-info">
        <div><b>運行狀態:</b> {{ running ? '運行中' : '已停止' }}</div>
        <div><b>研究來源數量:</b> {{ research.sources.length }}</div>
        <div><b>核心事實數量:</b> {{ research.facts.length }}</div>
        <div><b>AI回答:</b> {{ writerChunks ? '已接收' : '未接收' }}</div>
        <div><b>事實查核:</b> {{ factReport ? '已接收' : '未接收' }}</div>
        <div><b>交叉驗證:</b> {{ crossValidationResults.length }}</div>
        <div><b>不確定性評估:</b> {{ uncertaintyAssessment ? '已接收' : '未接收' }}</div>
        <div><b>可信度評分:</b> {{ credibilityScore ? '已接收' : '未接收' }}</div>
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

    <section v-if="writerChunks || running" class="panel">
      <h2>📝 AI 回答</h2>
      <div v-if="writerChunks" class="response-content" v-html="formatMarkdown(writerChunks)"></div>
      <div v-else-if="running && !finalized" class="muted">（正在生成回答…）</div>
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

    <!-- 新增：高優先級改進功能面板 -->
    
    <!-- 多源交叉驗證 -->
    <section v-if="crossValidationResults.length" class="panel">
      <h2>🔍 多源交叉驗證</h2>
      <div class="validation-results">
        <div v-for="(result, idx) in crossValidationResults" :key="idx" class="validation-item">
          <h4>Claim {{ idx + 1 }}: {{ result.claim }}</h4>
          <div class="validation-details">
            <div class="confidence-bar">
              <span>置信度: {{ result.confidence }}%</span>
              <div class="bar">
                <div :style="{ width: result.confidence + '%' }" :class="['fill', result.consensus]"></div>
              </div>
            </div>
            <div class="consensus-badge" :class="result.consensus">
              {{ result.consensus.toUpperCase() }}
            </div>
            <div class="evidence-strength" :class="result.evidenceStrength">
              證據強度: {{ result.evidenceStrength.toUpperCase() }}
            </div>
          </div>
          <div class="sources-analysis">
            <div v-if="result.supportingSources.length" class="supporting">
              <h5>✅ 支持來源 ({{ result.supportingSources.length }})</h5>
              <ul>
                <li v-for="(source, i) in result.supportingSources" :key="i">
                  <a :href="source.url" target="_blank" rel="noopener">{{ source.title || source.url }}</a>
                </li>
              </ul>
            </div>
            <div v-if="result.contradictingSources.length" class="contradicting">
              <h5>❌ 矛盾來源 ({{ result.contradictingSources.length }})</h5>
              <ul>
                <li v-for="(source, i) in result.contradictingSources" :key="i">
                  <a :href="source.url" target="_blank" rel="noopener">{{ source.title || source.url }}</a>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- 不確定性評估 -->
    <section v-if="uncertaintyAssessment" class="panel">
      <h2>⚠️ 不確定性評估</h2>
      <div class="uncertainty-details">
        <div class="confidence-overview">
          <div class="confidence-score">
            <span class="label">整體置信度</span>
            <span class="score" :class="uncertaintyAssessment.confidence < 0.7 ? 'low' : uncertaintyAssessment.confidence < 0.9 ? 'medium' : 'high'">
              {{ Math.round(uncertaintyAssessment.confidence * 100) }}%
            </span>
          </div>
          <div class="risk-level" :class="uncertaintyAssessment.riskLevel">
            風險等級: {{ uncertaintyAssessment.riskLevel.toUpperCase() }}
          </div>
          <div class="recommendation" :class="uncertaintyAssessment.recommendation">
            建議: {{ uncertaintyAssessment.recommendation.toUpperCase() }}
          </div>
        </div>
        
        <div v-if="uncertaintyAssessment.uncertaintyFactors.length" class="factors">
          <h4>不確定性因素</h4>
          <ul>
            <li v-for="(factor, idx) in uncertaintyAssessment.uncertaintyFactors" :key="idx">
              {{ factor }}
            </li>
          </ul>
        </div>
        
        <div v-if="uncertaintyAssessment.alternativeHypotheses.length" class="alternatives">
          <h4>替代假設</h4>
          <ul>
            <li v-for="(hypothesis, idx) in uncertaintyAssessment.alternativeHypotheses" :key="idx">
              {{ hypothesis }}
            </li>
          </ul>
        </div>
      </div>
    </section>

    <!-- 可信度評分 -->
    <section v-if="credibilityScore" class="panel">
      <h2>📊 可信度評分</h2>
      <div class="credibility-overview">
        <div class="overall-score">
          <span class="label">綜合可信度</span>
          <span class="score" :class="credibilityScore.overall < 60 ? 'low' : credibilityScore.overall < 80 ? 'medium' : 'high'">
            {{ credibilityScore.overall }}/100
          </span>
        </div>
        
        <div class="breakdown-grid">
          <div class="breakdown-item">
            <span class="label">來源質量</span>
            <div class="score-bar">
              <div :style="{ width: credibilityScore.breakdown.sourceQuality + '%' }" 
                   :class="['fill', credibilityScore.breakdown.sourceQuality < 60 ? 'low' : credibilityScore.breakdown.sourceQuality < 80 ? 'medium' : 'high']"></div>
            </div>
            <span class="value">{{ credibilityScore.breakdown.sourceQuality }}</span>
          </div>
          
          <div class="breakdown-item">
            <span class="label">事實查核</span>
            <div class="score-bar">
              <div :style="{ width: credibilityScore.breakdown.factChecking + '%' }" 
                   :class="['fill', credibilityScore.breakdown.factChecking < 60 ? 'low' : credibilityScore.breakdown.factChecking < 80 ? 'medium' : 'high']"></div>
            </div>
            <span class="value">{{ credibilityScore.breakdown.factChecking }}</span>
          </div>
          
          <div class="breakdown-item">
            <span class="label">交叉驗證</span>
            <div class="score-bar">
              <div :style="{ width: credibilityScore.breakdown.crossValidation + '%' }" 
                   :class="['fill', credibilityScore.breakdown.crossValidation < 60 ? 'low' : credibilityScore.breakdown.crossValidation < 80 ? 'medium' : 'high']"></div>
            </div>
            <span class="value">{{ credibilityScore.breakdown.crossValidation }}</span>
          </div>
          
          <div class="breakdown-item">
            <span class="label">時效性</span>
            <div class="score-bar">
              <div :style="{ width: credibilityScore.breakdown.temporalValidity + '%' }" 
                   :class="['fill', credibilityScore.breakdown.temporalValidity < 60 ? 'low' : credibilityScore.breakdown.temporalValidity < 80 ? 'medium' : 'high']"></div>
            </div>
            <span class="value">{{ credibilityScore.breakdown.temporalValidity }}</span>
          </div>
          
          <div class="breakdown-item">
            <span class="label">權威性</span>
            <div class="score-bar">
              <div :style="{ width: credibilityScore.breakdown.authorityWeight + '%' }" 
                   :class="['fill', credibilityScore.breakdown.authorityWeight < 60 ? 'low' : credibilityScore.breakdown.authorityWeight < 80 ? 'medium' : 'high']"></div>
            </div>
            <span class="value">{{ credibilityScore.breakdown.authorityWeight }}</span>
          </div>
        </div>
        
        <div v-if="credibilityScore.recommendations.length" class="recommendations">
          <h4>改進建議</h4>
          <ul>
            <li v-for="(rec, idx) in credibilityScore.recommendations" :key="idx">
              💡 {{ rec }}
            </li>
          </ul>
        </div>
        
        <div v-if="credibilityScore.warnings.length" class="warnings">
          <h4>⚠️ 警告</h4>
          <ul>
            <li v-for="(warning, idx) in credibilityScore.warnings" :key="idx">
              {{ warning }}
            </li>
          </ul>
        </div>
      </div>
    </section>

    <section v-if="tokens.total" class="panel">
      <h2>⏱️ Token 用量</h2>
      <div class="token-breakdown">
        <div class="token-section">
          <h4>📝 用戶輸入</h4>
          <div class="token-item">
            <span class="label">問題:</span>
            <span class="value">{{ tokens.questionTokens || questionTokenCount }}</span>
          </div>
        </div>
        
        <div class="token-section">
          <h4>⚙️ 系統開銷</h4>
          <div class="token-item">
            <span class="label">系統提示詞:</span>
            <span class="value">{{ tokens.systemTokens || 0 }}</span>
          </div>
          <div class="token-item">
            <span class="label">實際 Prompt:</span>
            <span class="value">{{ tokens.actualPromptTokens || 0 }}</span>
          </div>
        </div>
        
        <div class="token-section">
          <h4>🔄 API 調用</h4>
          <div class="token-item">
            <span class="label">Prompt:</span>
            <span class="value">{{ tokens.prompt }}</span>
          </div>
          <div class="token-item">
            <span class="label">Completion:</span>
            <span class="value">{{ tokens.completion }}</span>
          </div>
          <div class="token-item total">
            <span class="label">Total:</span>
            <span class="value">{{ tokens.total }}</span>
          </div>
        </div>
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
interface TokenUsage { 
  prompt: number; 
  completion: number; 
  total: number; 
  questionTokens?: number; // 用戶問題的原始 token 數
  systemTokens?: number;   // 系統提示詞和上下文的 token 數
  actualPromptTokens?: number; // 實際發送給 OpenAI 的 prompt tokens
}

// 新增：高優先級改進接口
interface SourceAuthority {
  domain: string;
  authorityScore: number;
  expertise: string[];
  verificationLevel: 'verified' | 'unverified';
  lastVerified?: string;
}

interface CrossValidationResult {
  claim: string;
  supportingSources: Source[];
  contradictingSources: Source[];
  confidence: number;
  consensus: 'strong' | 'weak' | 'conflicting';
  evidenceStrength: 'high' | 'medium' | 'low';
}

interface UncertaintyAssessment {
  confidence: number;
  uncertaintyFactors: string[];
  alternativeHypotheses: string[];
  recommendation: 'proceed' | 'caution' | 'reject';
  riskLevel: 'low' | 'medium' | 'high';
}

interface CredibilityScore {
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

/* ------------------------------ Local State ---------------------------- */
const question = ref('');
const running = ref(false);
const finalized = ref(false);
const plan = ref<RouterPlan | null>(null);
const research = reactive<ResearchBundle>({ id: '', query: '', sources: [], facts: [] });
const writerChunks = ref<string>('');
const factReport = ref<FactCheckReport | null>(null);
const tokens = reactive<TokenUsage>({ 
  prompt: 0, 
  completion: 0, 
  total: 0, 
  questionTokens: 0,
  systemTokens: 0,
  actualPromptTokens: 0
});

      // 新增：高優先級改進功能狀態
const crossValidationResults = ref<CrossValidationResult[]>([]);
const uncertaintyAssessment = ref<UncertaintyAssessment | null>(null);
const credibilityScore = ref<CredibilityScore | null>(null);

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
  
  // 添加MockService的自定義事件監聽器
  window.addEventListener('crossValidation', ((e: CustomEvent) => {
    crossValidationResults.value = e.detail;
  }) as EventListener);
  
  window.addEventListener('uncertainty', ((e: CustomEvent) => {
    uncertaintyAssessment.value = e.detail;
  }) as EventListener);
  
  window.addEventListener('credibility', ((e: CustomEvent) => {
    credibilityScore.value = e.detail;
  }) as EventListener);
});


function toggleSettings() { showSettings.value = !showSettings.value; }
function resetAll() {
  plan.value = null; research.id = ''; research.query = ''; research.sources = []; research.facts = [];
  writerChunks.value = ''; factReport.value = null; 
  tokens.prompt = tokens.completion = tokens.total = tokens.questionTokens = tokens.systemTokens = tokens.actualPromptTokens = 0;
  finalized.value = false; question.value = '';
  
  // 重置高优先级改进功能状态
  crossValidationResults.value = [];
  uncertaintyAssessment.value = null;
  credibilityScore.value = null;
}
function hostname(u: string) { try { return new URL(u).hostname; } catch { return '' } }

// 格式化Markdown文本为HTML
function formatMarkdown(text: string): string {
  if (!text) return '';
  return text
    .replace(/\n/g, '<br/>')
    .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`{3}([^`]+)`{3}/g, '<pre>$1</pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^### (.*$)/gim, '<h3>$1</h3>')
    .replace(/^## (.*$)/gim, '<h2>$1</h2>')
    .replace(/^# (.*$)/gim, '<h1>$1</h1>')
    .replace(/^- (.*$)/gim, '<li>$1</li>')
    .replace(/^\d+\. (.*$)/gim, '<li>$1</li>');
}

const writerHtml = computed(() => writerChunks.value
  .replace(/\n/g, '<br/>')
  .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
  .replace(/`{3}([^`]+)`{3}/g, '<pre>$1</pre>')
);

// 新增：計算問題的 token 數
const questionTokenCount = computed(() => {
  if (!question.value.trim()) return 0;
  
  // 更準確的 token 估算
  const text = question.value.trim();
  let tokenCount = 0;
  
  // 中文字符（包括繁体中文）
  const chineseChars = text.match(/[\u4e00-\u9fff\u3400-\u4dbf\u20000-\u2a6df\u2a700-\u2b73f\u2b740-\u2b81f\u2b820-\u2ceaf\uf900-\ufaff\u3300-\u33ff\ufe30-\ufe4f\uf900-\ufaff\u3300-\u33ff\ufe30-\ufe4f]/g);
  if (chineseChars) {
    tokenCount += chineseChars.length * 1.5; // 中文字符約1.5個token
  }
  
  // 英文字符和数字
  const englishChars = text.match(/[a-zA-Z0-9]/g);
  if (englishChars) {
    tokenCount += englishChars.length * 0.25; // 英文字符約0.25個token
  }
  
  // 标点符号和空格
  const punctuationChars = text.match(/[^\u4e00-\u9fff\u3400-\u4dbf\u20000-\u2a6df\u2a700-\u2b73f\u2b740-\u2b81f\u2b820-\u2ceaf\uf900-\ufaff\u3300-\u33ff\ufe30-\ufe4f\uf900-\ufaff\u3300-\u33ff\ufe30-\ufe4f\wa-zA-Z0-9]/g);
  if (punctuationChars) {
    tokenCount += punctuationChars.length * 0.1; // 標點符號約0.1個token
  }
  
  // 如果沒有匹配到任何字符，使用默認估算
  if (tokenCount === 0) {
    tokenCount = Math.ceil(text.length / 4);
  }
  
  return Math.ceil(tokenCount);
});

/* ------------------------------ Runner Core ---------------------------- */
async function run() {
  if (!question.value.trim() || running.value) return;
  running.value = true; finalized.value = false; writerChunks.value = ''; factReport.value = null; plan.value = null;
  research.id = ''; research.query = ''; research.sources = []; research.facts = [];
  tokens.prompt = tokens.completion = tokens.total = tokens.questionTokens = tokens.systemTokens = tokens.actualPromptTokens = 0;
  
  // 重置高优先级改进功能状态
  crossValidationResults.value = [];
  uncertaintyAssessment.value = null;
  credibilityScore.value = null;

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
  console.log('[Frontend] 连接到SSE:', url);
  const es = new EventSource(url);
  
        // 添加連接狀態監控
  es.onopen = () => console.log('[Frontend] SSE连接已建立');
  es.onerror = (error) => console.error('[Frontend] SSE连接错误:', error);
  
  // 监听连接关闭事件
  es.addEventListener('close', () => console.log('[Frontend] SSE连接已关闭'));

  es.addEventListener('plan', (e: MessageEvent) => { opts.onPlan(JSON.parse(e.data)); });
  es.addEventListener('sources', (e: MessageEvent) => { 
    console.log('[Frontend] 收到sources事件:', e.data);
    const sources = JSON.parse(e.data);
    console.log('[Frontend] 解析后的sources:', sources);
    research.sources = sources;
    console.log('[Frontend] research.sources已更新，长度:', research.sources.length);
  });
  es.addEventListener('facts', (e: MessageEvent) => { 
    console.log('[Frontend] 收到facts事件:', e.data);
    const facts = JSON.parse(e.data);
    console.log('[Frontend] 解析后的facts:', facts);
    research.facts = facts;
    console.log('[Frontend] research.facts已更新，长度:', research.facts.length);
  });
  es.addEventListener('analysis', (e: MessageEvent) => { 
    const analysis = JSON.parse(e.data);
          // 存儲分析結果
  });
  es.addEventListener('response', (e: MessageEvent) => { 
    console.log('[Frontend] 收到response事件:', e.data);
    const response = JSON.parse(e.data);
    console.log('[Frontend] 解析后的response:', response);
          // 存儲最終回答
    writerChunks.value = response;
    console.log('[Frontend] writerChunks已更新:', writerChunks.value);
  });
  es.addEventListener('factcheck', (e: MessageEvent) => { 
    console.log('[Frontend] 收到factcheck事件:', e.data);
    const factReport = JSON.parse(e.data);
    console.log('[Frontend] 解析后的factcheck:', factReport);
    opts.onFactReport(factReport);
  });
  
  // 新增：评论事件处理
  es.addEventListener('critique', (e: MessageEvent) => { 
    console.log('[Frontend] 收到critique事件:', e.data);
          // 可以在這裡處理評論結果
  });
  
  // 新增：高优先级改进功能事件处理
  es.addEventListener('crossValidation', (e: MessageEvent) => { 
    console.log('[Frontend] 收到crossValidation事件:', e.data);
    try {
      const parsedData = JSON.parse(e.data);
      console.log('[Frontend] 解析后的crossValidation数据:', parsedData);
      console.log('[Frontend] 数据长度:', parsedData.length);
      crossValidationResults.value = parsedData;
      console.log('[Frontend] crossValidationResults已更新，当前长度:', crossValidationResults.value.length);
    } catch (error) {
      console.error('[Frontend] 解析crossValidation数据失败:', error);
      console.error('[Frontend] 原始数据:', e.data);
    }
  });
  es.addEventListener('uncertainty', (e: MessageEvent) => { 
    console.log('[Frontend] 收到uncertainty事件:', e.data);
    uncertaintyAssessment.value = JSON.parse(e.data); 
  });
  es.addEventListener('credibility', (e: MessageEvent) => { 
    console.log('[Frontend] 收到credibility事件:', e.data);
    credibilityScore.value = JSON.parse(e.data); 
  });
  
  // 新增：性能统计事件处理
  es.addEventListener('performance', (e: MessageEvent) => { 
    const stats = JSON.parse(e.data);
    console.log('📊 性能统计:', stats);
  });
  
  es.addEventListener('tokens', (e: MessageEvent) => { opts.onTokens(JSON.parse(e.data)); });
  es.addEventListener('done', () => { es.close(); opts.onDone(); });
  es.addEventListener('error', (e: MessageEvent) => { 
    console.error('[Frontend] 收到错误事件:', e.data);
    try {
      const errorData = JSON.parse(e.data);
      alert(`执行错误: ${errorData.message}\n\n详情: ${errorData.error}`);
    } catch {
      alert(`执行错误: ${e.data}`);
    }
  });
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

    // 5) 新增：高优先级改进功能 (Demo模式)
    await delay(200);
    
          // 5.1 多源交叉驗證
    const crossValidationResults: CrossValidationResult[] = [
      {
        claim: 'Fact #1 from Source A',
        supportingSources: [bundle.sources[0]],
        contradictingSources: [],
        confidence: 0.85,
        consensus: 'strong',
        evidenceStrength: 'high'
      },
      {
        claim: 'Fact #2 from Source B',
        supportingSources: [bundle.sources[1]],
        contradictingSources: [bundle.sources[2]],
        confidence: 0.65,
        consensus: 'weak',
        evidenceStrength: 'medium'
      }
    ];
    
          // 5.2 不確定性評估
    const uncertaintyAssessment: UncertaintyAssessment = {
      confidence: 0.75,
      uncertaintyFactors: [
        'Limited number of sources (only 3)',
        'One conflicting claim detected'
      ],
      alternativeHypotheses: [
        'Alternative interpretation of Fact #2 exists'
      ],
      recommendation: 'caution',
      riskLevel: 'medium'
    };
    
          // 5.3 可信度評分
    const credibilityScore: CredibilityScore = {
      overall: 72,
      breakdown: {
        sourceQuality: 75,
        factChecking: 70,
        crossValidation: 65,
        temporalValidity: 80,
        authorityWeight: 70
      },
      recommendations: [
        'Consider using more authoritative sources',
        'Verify conflicting claims with additional sources'
      ],
      warnings: [
        'Multiple sources show conflicting information',
        'Exercise caution when using this information'
      ]
    };
    
    // 模拟SSE事件 - 通过回调函数传递数据
    setTimeout(() => {
      // 模拟crossValidation事件
      const event = new CustomEvent('crossValidation', { 
        detail: crossValidationResults 
      });
      window.dispatchEvent(event);
      
      // 模拟uncertainty事件
      const event2 = new CustomEvent('uncertainty', { 
        detail: uncertaintyAssessment 
      });
      window.dispatchEvent(event2);
      
      // 模拟credibility事件
      const event3 = new CustomEvent('credibility', { 
        detail: credibilityScore 
      });
      window.dispatchEvent(event3);
    }, 100);

    // 6) Tokens
    const questionTokens = Math.ceil(opts.question.length / 4); // 简单估算
    const systemTokens = 200 + (opts.settings.useWeb ? 150 : 50) + 
                        (opts.settings.speedMode === 'thorough' ? 300 : opts.settings.speedMode === 'balanced' ? 200 : 100) +
                        (opts.settings.lang === 'auto' ? 50 : 100) + 100;
    const actualPromptTokens = questionTokens + systemTokens;
    
    opts.onTokens({ 
      prompt: 1432, 
      completion: 987, 
      total: 2419,
      questionTokens,
      systemTokens,
      actualPromptTokens
    });

    // 7) Done
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
.grid.four { display:grid; grid-template-columns: repeat(4,1fr); gap:12px; }

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

/* 新增：高优先级改进功能样式 */

/* 多源交叉驗證 */
.validation-results { display: flex; flex-direction: column; gap: 16px; }
.validation-item {
  padding: 16px; border: 1px solid var(--border); border-radius: 12px;
  background: var(--surface);
}
.validation-item h4 { margin: 0 0 12px 0; color: var(--text); }
.validation-details {
  display: flex; align-items: center; gap: 16px; margin-bottom: 16px;
  flex-wrap: wrap;
}
.confidence-bar {
  display: flex; flex-direction: column; gap: 4px; min-width: 200px;
}
.confidence-bar span { font-size: 14px; color: var(--muted); }
.bar {
  width: 100%; height: 8px; background: var(--border); border-radius: 4px;
  overflow: hidden;
}
.bar .fill {
  height: 100%; border-radius: 4px; transition: width 0.3s ease;
}
.bar .fill.strong { background: var(--green); }
.bar .fill.weak { background: var(--yellow); }
.bar .fill.conflicting { background: var(--red); }

.consensus-badge {
  padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600;
  text-transform: uppercase;
}
.consensus-badge.strong { background: #d1fae5; color: #065f46; }
.consensus-badge.weak { background: #fef3c7; color: #92400e; }
.consensus-badge.conflicting { background: #fee2e2; color: #991b1b; }

.evidence-strength {
  padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600;
  text-transform: uppercase;
}
.evidence-strength.high { background: #dbeafe; color: #1e40af; }
.evidence-strength.medium { background: #fef3c7; color: #92400e; }
.evidence-strength.low { background: #fee2e2; color: #991b1b; }

.sources-analysis {
  display: grid; grid-template-columns: 1fr 1fr; gap: 16px;
}
.sources-analysis h5 { margin: 0 0 8px 0; font-size: 14px; }
.sources-analysis ul { margin: 0; padding-left: 20px; }
.sources-analysis li { margin-bottom: 4px; }
.sources-analysis a { color: var(--accent); text-decoration: none; }
.sources-analysis a:hover { text-decoration: underline; }

/* 不確定性評估 */
.uncertainty-details { display: flex; flex-direction: column; gap: 20px; }
.confidence-overview {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px;
  padding: 20px; background: var(--surface); border-radius: 12px;
}
.confidence-score {
  display: flex; flex-direction: column; align-items: center; gap: 8px;
}
.confidence-score .label { font-size: 14px; color: var(--muted); }
.confidence-score .score {
  font-size: 32px; font-weight: 700; padding: 8px 16px; border-radius: 8px;
}
.confidence-score .score.high { background: #d1fae5; color: #065f46; }
.confidence-score .score.medium { background: #fef3c7; color: #92400e; }
.confidence-score .score.low { background: #fee2e2; color: #991b1b; }

.risk-level, .recommendation {
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  padding: 16px; border-radius: 8px; text-align: center;
}
.risk-level.low { background: #d1fae5; color: #065f46; }
.risk-level.medium { background: #fef3c7; color: #92400e; }
.risk-level.high { background: #fee2e2; color: #991b1b; }

.recommendation.proceed { background: #d1fae5; color: #065f46; }
.recommendation.caution { background: #fef3c7; color: #92400e; }
.recommendation.reject { background: #fee2e2; color: #991b1b; }

.factors, .alternatives {
  padding: 16px; background: var(--surface); border-radius: 12px;
}
.factors h4, .alternatives h4 { margin: 0 0 12px 0; color: var(--text); }
.factors ul, .alternatives ul { margin: 0; padding-left: 20px; }
.factors li, .alternatives li { margin-bottom: 8px; color: var(--text); }

/* 可信度評分 */
.credibility-overview { display: flex; flex-direction: column; gap: 24px; }
.overall-score {
  display: flex; flex-direction: column; align-items: center; gap: 12px;
  padding: 24px; background: var(--surface); border-radius: 16px;
}
.overall-score .label { font-size: 16px; color: var(--muted); }
.overall-score .score {
  font-size: 48px; font-weight: 800; padding: 16px 24px; border-radius: 12px;
}
.overall-score .score.high { background: #d1fae5; color: #065f46; }
.overall-score .score.medium { background: #fef3c7; color: #92400e; }
.overall-score .score.low { background: #fee2e2; color: #991b1b; }

.breakdown-grid {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px;
}
.breakdown-item {
  display: flex; flex-direction: column; gap: 8px;
  padding: 16px; background: var(--surface); border-radius: 12px;
}
.breakdown-item .label { font-size: 14px; color: var(--muted); }
.score-bar {
  width: 100%; height: 12px; background: var(--border); border-radius: 6px;
  overflow: hidden; position: relative;
}
.score-bar .fill {
  height: 100%; border-radius: 6px; transition: width 0.5s ease;
}
.score-bar .fill.high { background: var(--green); }
.score-bar .fill.medium { background: var(--yellow); }
.score-bar .fill.low { background: var(--red); }
.breakdown-item .value {
  font-size: 18px; font-weight: 700; text-align: center;
  color: var(--text);
}

.recommendations, .warnings {
  padding: 20px; background: var(--surface); border-radius: 12px;
}
.recommendations h4, .warnings h4 { margin: 0 0 16px 0; color: var(--text); }
.recommendations ul, .warnings ul { margin: 0; padding-left: 20px; }
.recommendations li, .warnings li { 
  margin-bottom: 12px; color: var(--text); line-height: 1.6;
}
.recommendations li { color: #065f46; }
.warnings li { color: #991b1b; }

/* 响应式设计 */
@media (max-width: 768px) {
  .sources-analysis { grid-template-columns: 1fr; }
  .confidence-overview { grid-template-columns: 1fr; }
  .breakdown-grid { grid-template-columns: 1fr; }
  .validation-details { flex-direction: column; align-items: flex-start; }
}

/* 问题 Token 数显示 */
.question-tokens {
  margin-top: 8px;
  padding: 12px;
  background: var(--surface);
  border-radius: 8px;
  border: 1px solid var(--border);
  text-align: center;
}

.question-tokens .token-info {
  font-size: 14px;
  color: var(--muted);
  display: block;
  margin-bottom: 4px;
}

.question-tokens .token-info strong {
  color: var(--accent);
  font-weight: 600;
}

.question-tokens .token-info small {
  color: var(--muted);
  font-size: 12px;
  margin-left: 4px;
}

.question-tokens .token-note {
  margin-top: 4px;
}

.question-tokens .token-note small {
  color: var(--muted);
  font-size: 11px;
  font-style: italic;
}

/* 新增：Token 用量面板樣式 */
.token-breakdown {
  display: flex; flex-direction: column; gap: 16px;
  padding: 16px; background: var(--surface); border-radius: 12px;
}

.token-section {
  display: flex; flex-direction: column; gap: 8px;
}

.token-item {
  display: flex; justify-content: space-between; align-items: center;
  padding: 8px 12px; background: var(--button); border-radius: 8px;
  border: 1px solid var(--border);
}

.token-item .label {
  font-size: 14px; color: var(--muted); font-weight: 500;
}

.token-item .value {
  font-size: 18px; font-weight: 700; color: var(--text);
}

.token-item.total {
  background: #1a2a3d; border-color: #294a6b; color: #dcefff;
}
</style>
