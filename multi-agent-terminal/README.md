# Multi-Agent CLI

在終端機互動的多代理問答工具：**Router → Researcher → Analyst → Writer → FactChecker → Critic**  
支援 **真實網路搜尋（Tavily）**、**長文輸出**、**事實查核**、**記憶**、**多速度模式**、**時間上限**、以及 **自動/手動輸出語言**。

## ✨ 功能特點
- 多代理協作：自動規劃路由、查找資料、撰寫、查核與評審
- 真實網路檢索：整合 Tavily 取得即時資訊
- 長文生成與事實查核：兼顧完整度與可信度
- 記憶系統：可查看、清空與匯出過去記憶
- 多速度模式與時間上限：在速度與完整度間自由切換
- 多語輸出：自動偵測或固定英文／繁中／日文／韓文

---

## 🧩 系統需求
- Node.js **≥ 18.17**（18 / 20 / 22 皆可）
- npm / pnpm / yarn（以下示範以 **npm**）

## 🔐 需要準備
- **OpenAI API Key**
- **Tavily API Key**

---

## 📦 安裝
```bash
# 1) 下載專案
git clone https://github.com/zhewei11/multiagent-cli.git
cd multiagent-cli

# 2) 安裝依賴
npm i

# 3) 若沒有 tsx（推薦用它執行 TS）
npm i -D tsx
```

---

## ⚙️ 設定環境變數（.env）
```env
# 必填
OPENAI_API_KEY=sk-xxxx
TAVILY_API_KEY=tvly-xxxx

# 選填（有預設）
TARGET_LANG=auto           # auto|en|zh-TW|ja|ko
SPEED_MODE=balanced        # fast|balanced|thorough
MAX_TIME_MS=20000          # 單輪時間上限（毫秒），0 或留白 = 不限制
QUERY_EXPANSION=1          # 多語查詢擴充（0/1）
```

---

## ▶️ 執行
在 `package.json` 加入 script（若尚未加入）：
```json
{
  "scripts": {
    "chat": "tsx app.ts",
    "typecheck": "tsc -noEmit"
  }
}
```

啟動互動 CLI：
```bash
npm run chat
```

看到 `You:` 提示後，直接輸入問題即可開始多輪對話。

---

## ⌨️ 互動指令
| 指令 | 說明 |
|---|---|
| `:help` | 顯示指令說明 |
| `:mem` | 顯示最近 10 筆記憶 |
| `:clear` | 清空記憶檔（`memory.jsonl`） |
| `:export <path>` | 匯出記憶為 JSONL |
| `:web on|off` | 強制開/關網路搜尋（預設由 Router 判斷） |
| `:plan <question>` | 預覽路由計畫（不真正回答） |
| `:speed fast|balanced|thorough` | 切換速度模式 |
| `:time <Nms|Ns|Nm|off|show>` | 設定/關閉/查看單輪時間上限（例：`:time 20s`） |
| `:lang auto|en|zh-TW|ja|ko` | 切換輸出語言（`auto` = 跟隨提問語言） |
| `:tokens` | 顯示上一輪與整個 session 的 token 用量 |
| `:exit` | 離開 |

### 小撇步
- 想更快出結果：用 `:speed fast` 或 `:time 10s`
- 想更完整、像報告：用 `:speed thorough` 並提高 `MAX_TIME_MS`
- 想固定英文或繁中：用 `:lang en` / `:lang zh-TW`

---

## ❓ 常見問題（FAQ）

**Q1. 跑起來顯示 `tsx: command not found`？**  
A：執行 `npm i -D tsx`，並確認 `npm run chat` 的 script 為 `"tsx app.ts"`。

**Q2. 回答太短、只有幾句？**  
A：切換 `:speed thorough`，或提高 `.env` 的 `MAX_TIME_MS`，並確保 `QUERY_EXPANSION=1`。
