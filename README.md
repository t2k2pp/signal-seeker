# SignalSeeker

技術・AI分野の **一次情報を自動収集** し、客観ファクトの要約レポートとして手元に届けるツール。

```
Collect (Playwright + RSS) → Summarize (Claude/ローカルLLM) → Report/Notify → Wiki (Obsidian)
   差分だけ取得・全件をDBに蓄積    煽りを排した4観点ファクト抽出    Markdown送付      蓄積から知識ベース生成
```

「欲しい情報を変える」操作は **訪問先リスト `config/sources.json` の編集だけ** で完結します。
リストのメンテナンスは別ツール想定で、本アプリはリストを読み取るのみです。

## 生成AIの使用範囲(設計方針)

生成AIを使うのは **② 概要化の1箇所だけ** です。取得・差分判定・レポート送付・Wiki生成は AI を使わない
決定的処理で、取得先の選定が適切であれば LLM コストは要約に集約されます(Wiki も要約を再利用するだけ)。

| 段階 | 担当 | 生成AI | 内容 |
| --- | --- | --- | --- |
| ① 取得 | `src/collector/` | **不使用** | rss-parser でフィード取得 / Playwright で DOM・本文抽出 |
| 差分判定 | `src/db.ts` | **不使用** | `content_hash` の比較で新規・更新を検知(SHA-256) |
| ② 概要化 | `src/summarizer/` + `src/llm/` | **使用** | Claude / ローカルLLM で4観点の客観ファクト抽出 |
| ③ 送付 | `src/report/` + `src/notify/` | **不使用** | Markdown 整形 + Discord Webhook / コンソール |
| Wiki生成 | `src/wiki/` | **不使用** | DB の要約から Obsidian vault を機械的に生成(検索/カテゴリ/リンク) |

### データの蓄積と再利用

収集した全記事は SQLite `data/signalseeker.db` に**要約付きで永続化**され、レポートと Wiki の両方で
再利用されます(同じ記事を二度要約しません)。`reported` フラグで配信済みを管理します。

- **dry実行(`--dry-run`)は差分を消費しません。** レポートはファイル保存され閲覧できますが、配信済みにはせず
  保持するため、**次の本実行(`crawl`)のレポートに繰り越して取り込まれます**(レポート上は `📥繰越`)。
- 本実行のみ配信済み(`reported=1`)にします。

## セットアップ

```bash
npm install
npx playwright install chromium      # html型ソースの巡回に必要
cp .env.example .env                 # ANTHROPIC_API_KEY / DISCORD_WEBHOOK_URL を記入
```

## 実行

```bash
npm run crawl        # 収集 → 要約 → レポート/通知 → Wiki生成(配信済み化)
npm run crawl:dry    # 同上だが通知せず・配信済みにしない(次の本実行に繰り越し)
npm run wiki         # DBの蓄積から Obsidian vault だけを再生成(収集・要約なし)
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
  "firstRunLimit": 5,        // 初回実行時、source毎に取り込む最大件数(差分ノイズ抑制)
  "collect": {
    "maxContentChars": 8000, // 1記事あたり保持・要約に渡す最大文字数(増やすほど情報量↑・処理↑)
    "fetchArticleBody": true // html型で各記事ページの本文も取得するか(false=一覧リンクのみ)
  },
  "wiki": {
    "enabled": true,
    "vaultPath": "data/wiki",      // Obsidian vault(相対 or 絶対パス)
    "defaultTags": ["signalseeker"]
  }
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

#### 取得情報量

`collect.maxContentChars` で1記事あたりの保持・要約対象の文字数を変更できます。`fetchArticleBody: true`
の場合、html型は一覧リンクだけでなく**各記事ページの本文**(`article`/`main`/`body`)も取得します。
情報量は増えますが、記事ごとにページを開くため収集は遅くなります。

## 蓄積

- **状態・要約**: SQLite `data/signalseeker.db`。`(source_id, item_key)` で記事を管理し、
  `content_hash` の変化で更新を検知。**要約も含めて永続化**するため、レポート・Wikiで再利用され、
  同一記事の再要約を避けます。`reported` で配信済みを管理(dry実行は未配信のまま繰り越し)。
- **レポート**: `data/reports/YYYY-MM-DD.md`(人間が読む用)。
- **Wiki**: `data/wiki/`(Obsidian vault、下記)。

## Wiki(Obsidian)

蓄積データを **Obsidian で開ける Markdown ナレッジベース**として `data/wiki/` に生成します。本実行・dry実行の
両方で(要約済みデータから)再生成され、`npm run wiki` で単体再生成も可能です。Obsidian でこのフォルダを
vault として開けば、**全文検索・タグ絞り込み・グラフ表示**がそのまま使えます。

```
data/wiki/
  index.md                         # ルートMOC: カテゴリ一覧(件数つき)
  MOC/MOC <カテゴリ>.md            # カテゴリ別MOC: ソースでグループ化し [[wikilink]] で各記事へ
  Notes/<タイトル>-<hash>.md       # 記事ノート: frontmatter + 要約 + 本文抜粋 + エビデンスリンク
```

- **検索**: Obsidian 標準の全文検索/タグ検索(`category/…`, `source/…` の階層タグを自動付与)。
- **カテゴリ・グループ化**: `index.md` → カテゴリMOC → ソース単位のリンク、で辿れる。
- **エビデンス**: 各ノートの frontmatter `source:` と本文の「出典」リンクが元記事を指す。
- 管理対象は `Notes/`・`MOC/`・`index.md` のみ。これらは毎回再生成されるため、同フォルダ内に手書きノートを
  置かないでください(将来 HTML 出力へ移行しやすい構成です)。

> 現状(MVP)はカテゴリ分け・グループ化を**メタデータで機械的に**行います。AIによるテーマ抽出/概観の自動生成は
> 将来の拡張ポイントです(`src/wiki/` を差し替え)。

## 注意点

- 概要化に**低速なローカル reasoning モデル**を使う場合、1記事あたり数分かかることがあります
  (`openai-compat` のタイムアウトは10分)。`firstRunLimit` を下げる、量子化モデルを使う等で調整してください。
- Claude のプロンプトキャッシュは Haiku 4.5 で最小 4096 トークンが必要です。System プロンプトが
  短いとキャッシュは無効化されます(害はありませんが、コスト削減効果は出ません)。
- `html` 型はサイト構造の変更でセレクタが効かなくなることがあります。その場合は `selector` を調整してください。
