# SignalSeeker

技術・AI分野の **一次情報を自動収集** し、客観ファクトの要約レポートとして手元に届けるツール。

```
Collect (Playwright + RSS)  →  Summarize (Claude / ローカルLLM)  →  Notify (Discord / コンソール)
   前回との差分だけ取得            煽りを排した4観点ファクト抽出          Markdownレポートを送付
```

「欲しい情報を変える」操作は **訪問先リスト `config/sources.json` の編集だけ** で完結します。
リストのメンテナンスは別ツール想定で、本アプリはリストを読み取るのみです。

## 生成AIの使用範囲(設計方針)

生成AIを使うのは **② 概要化の1箇所だけ** です。取得・差分判定・レポート送付は AI を使わない決定的処理で、
取得先の選定が適切であれば LLM コストは要約に集約されます。

| 段階 | 担当 | 生成AI | 内容 |
| --- | --- | --- | --- |
| ① 取得 | `src/collector/` | **不使用** | rss-parser でフィード取得 / Playwright で DOM 抽出 |
| 差分判定 | `src/db.ts` | **不使用** | `content_hash` の比較で新規・更新を検知(SHA-256) |
| ② 概要化 | `src/summarizer/` + `src/llm/` | **使用** | Claude / ローカルLLM で4観点の客観ファクト抽出 |
| ③ 送付 | `src/report/` + `src/notify/` | **不使用** | Markdown 整形 + Discord Webhook / コンソール |

## セットアップ

```bash
npm install
npx playwright install chromium      # html型ソースの巡回に必要
cp .env.example .env                 # ANTHROPIC_API_KEY / DISCORD_WEBHOOK_URL を記入
```

## 実行

```bash
npm run crawl        # 収集 → 要約 → レポート生成 → 通知
npm run crawl:dry    # 通知せずレポート生成・保存のみ(動作確認用)
npm run typecheck    # 型チェック
```

定期実行は OS のスケジューラに委譲してください。

- **Windows (タスクスケジューラ)**: 「プログラム」に `npm`、「引数」に `run crawl`、「開始(作業フォルダ)」に本リポジトリのパスを指定。
- **cron**: `0 8 * * * cd /path/to/SignalSeeker && npm run crawl >> data/cron.log 2>&1`

## 設定

### 訪問先リスト `config/sources.json`

```jsonc
{
  "id": "anthropic-news",
  "name": "Anthropic News",
  "url": "https://www.anthropic.com/news",
  "type": "html",            // "rss" | "html" | "github_release"
  "category": "基盤技術・組織公式",
  "selector": "a[href*='/news/']", // html型のみ: 一覧リンクの抽出セレクタ
  "maxLinks": 15,            // html型のみ(任意)
  "enabled": true
}
```

- `rss`: RSS/Atom を `rss-parser` で取得(ブラウザ不要・高速)。
- `html`: feed の無いページを Playwright で巡回し、`selector` で一覧リンクを抽出。
- `github_release`: repo URL を `/releases.atom` に正規化して取得。

### 実行設定 `config/config.json`

```jsonc
{
  "llm": {
    "endpoint":     { "providerType": "anthropic", "model": "claude-haiku-4-5", "apiKey": "env:ANTHROPIC_API_KEY" },
    "deepEndpoint": { "providerType": "anthropic", "model": "claude-opus-4-8",  "apiKey": "env:ANTHROPIC_API_KEY" }
  },
  "notify": { "targets": ["console", "discord"] },
  "firstRunLimit": 5   // 初回実行時、source毎に取り込む最大件数(差分ノイズ抑制)
}
```

#### LLM プロバイダの切替

`llm.endpoint` を差し替えるだけで切り替わります(コード変更不要)。設計は `claudeclone/lllmAgents`
のプロバイダ抽象を踏襲しています。

| 用途 | endpoint 例 |
| --- | --- |
| Claude(コスト重視) | `{ "providerType": "anthropic", "model": "claude-haiku-4-5", "apiKey": "env:ANTHROPIC_API_KEY" }` |
| Claude(深掘り) | `{ "providerType": "anthropic", "model": "claude-opus-4-8", "apiKey": "env:ANTHROPIC_API_KEY" }` |
| Ollama(ローカル) | `{ "providerType": "ollama", "model": "gpt-oss", "baseUrl": "http://localhost:11434/v1" }` |
| LM Studio | `{ "providerType": "lmstudio", "model": "...", "baseUrl": "http://localhost:1234/v1" }` |
| llama.cpp / vLLM | `{ "providerType": "llamacpp", "model": "...", "baseUrl": "http://localhost:8080/v1" }` |

ローカル系(ollama/lmstudio/llamacpp/vllm)は OpenAI 互換 `/v1/chat/completions` で一括対応します。
`apiKey` は `"env:NAME"` で環境変数解決、それ以外は平文として扱います。

## 蓄積

- **状態・差分**: SQLite `data/signalseeker.db`。`(source_id, item_key)` で記事を管理し、
  `content_hash` の変化で「更新」を検知。差分(新規・更新)だけを要約に回します。
- **レポート**: `data/reports/YYYY-MM-DD.md`(人間が読む用)。

## 注意点

- Claude のプロンプトキャッシュは Haiku 4.5 で最小 4096 トークンが必要です。System プロンプトが
  短いとキャッシュは無効化されます(害はありませんが、コスト削減効果は出ません)。
- `html` 型はサイト構造の変更でセレクタが効かなくなることがあります。その場合は `selector` を調整してください。
