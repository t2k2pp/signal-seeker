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
| ③ 送付 | `src/report/` + `src/notify/` | **不使用** | Markdown 整形 + Discord Webhook(全文を添付ファイルで送付)/ コンソール |
| Wiki生成 | `src/wiki/` | **不使用** | DB の要約から Obsidian vault を機械的に生成(検索/カテゴリ/リンク) |
| 期間集計(任意) | `src/report/weekly-cli.ts` | **不使用** | 蓄積データから週次相当(最大15日)レポートを生成(`npm run weekly`) |
| 整形(任意) | `src/report/html.ts` + `cli.ts` | **不使用** | レポートを HTML インフォグラフィックに整形(`npm run infographic`) |

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
cp .env.example .env                 # ANTHROPIC_API_KEY / Discord webhook を記入
```

## チャンネル(収集セット)

ジャンルの異なる収集セットを「**チャンネル**」として分けて運用できます(例: `ai-tech`=AI・技術 /
`us-stocks`=米国株 / `jp-economy`=国内景気 / `jp-companies`=国内企業)。チャンネルごとに **設定・データベース・
レポート・Discord 投稿先・要約の観点** がすべて分かれます(マルチチャンネル)。

- 設定: `config/channels/<id>/{config.json, sources.json}`
- データ: `data/<id>/`(DB・レポート・Wiki・ログ)
- Discord 投稿先: 各 `config.json` の `notify.discordWebhookEnv` で `.env` の webhook を指定

**新しいチャンネルを足す**には、`config/channels/<新id>/` に `config.json`(既存をコピーして `name`・観点
`extraction`・`notify.discordWebhookEnv` を変更)と `sources.json`(最初は `[]`)を置くだけです。

## 実行

すべてのコマンドで **`--channel=<id>`** を付けて対象を指定します(`--channel=all` で全チャンネル順次)。

```bash
npm run crawl -- --channel=ai-tech        # 収集→要約→レポート/通知→Wiki(配信済み化)
npm run crawl -- --channel=all            # 全チャンネルを順番に実行
npm run crawl:dry -- --channel=ai-tech    # 通知せず・配信済みにしない(繰り越し)
npm run crawl:resume -- --channel=ai-tech # 収集をスキップしDBの未処理分から再開(中断復旧)
npm run wiki -- --channel=ai-tech         # Obsidian vault だけ再生成(収集・要約なし)
npm run weekly -- --channel=ai-tech       # 週次相当レポート(最大15日、下記)
npm run infographic -- --channel=ai-tech  # 直近レポートを HTML に整形+Discord送付(下記)
npm run db -- --channel=ai-tech stats     # DB閲覧(開発者向け、下記)
npm run config -- --channel=ai-tech       # 設定メンテナンス(対話メニュー、下記)
npm run typecheck                         # 型チェック(チャンネル指定不要)
```

> `--channel` を省略した場合、チャンネルが1つだけならそれを使い、複数あるときは一覧を表示して中止します。

定期実行は OS のスケジューラに委譲してください(**チャンネルごとにタスクを登録**します)。

- **Windows (タスクスケジューラ)**: 「プログラム」に `npm`、「引数」に `run crawl -- --channel=ai-tech`、
  「開始(作業フォルダ)」に本リポジトリのパスを指定。
- **cron**: `0 8 * * * cd /path/to/SignalSeeker && npm run crawl -- --channel=ai-tech >> data/cron.log 2>&1`

## 設定

設定はチャンネルごとに `config/channels/<id>/` 配下にあります。

### 訪問先リスト `config/channels/<id>/sources.json`

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

### 実行設定 `config/channels/<id>/config.json`

```jsonc
{
  "name": "AI・技術",          // チャンネル表示名(レポート/通知の見出しに付く)
  "llm": {
    "endpoint":     { "providerType": "anthropic", "model": "claude-haiku-4-5", "apiKey": "env:ANTHROPIC_API_KEY" },
    "deepEndpoint": { "providerType": "anthropic", "model": "claude-opus-4-8",  "apiKey": "env:ANTHROPIC_API_KEY" }
  },
  // Discord 投稿先はチャンネルごとに分ける。webhook URL は .env に置き、その「環境変数名」をここで指定する
  "notify": { "targets": ["console", "discord"], "discordWebhookEnv": "DISCORD_WEBHOOK_URL" },
  // 要約の抽出観点(ジャンル別)。日本語出力・客観性のルールは共通で、役割と観点だけ差し替える
  "extraction": {
    "role": "技術情報の客観的ファクト抽出器",
    "viewpoints": ["技術的仕様変更", "アーキテクチャの提案", "OSSの破壊的変更", "実運用上の課題"]
  },
  "firstRunLimit": 5,        // 初回実行時、source毎に取り込む最大件数(差分ノイズ抑制)
  "collect": {
    "maxContentChars": 8000, // 1記事あたり保持・要約に渡す最大文字数(増やすほど情報量↑・処理↑)
    "fetchArticleBody": true // html型で各記事ページの本文も取得するか(false=一覧リンクのみ)
  },
  "wiki": {
    "enabled": true,               // vault は data/<id>/wiki に自動で分かれます
    "defaultTags": ["signalseeker"]
  },
  "runtime": {                     // タイムアウト等の閾値はすべてここに集約(コードにハードコードしない)
    "http": {
      "llmChatTimeoutMs": 600000,  // LLM応答待ち(低速ローカルモデルは大きめに)
      "llmTestTimeoutMs": 8000,    // LLM接続確認
      "rssTimeoutMs": 20000,       // RSS/Atom取得
      "discordTimeoutMs": 15000,   // Discord webhook
      "discordRetryUnitMs": 1000   // 429時 retry-after(秒)に掛ける単位ms
    },
    "playwright": {
      "navTimeoutMs": 30000,       // 一覧ページ
      "articleTimeoutMs": 25000    // 記事ページ本文取得
    },
    "logging": {
      "dir": "data/logs",
      "level": "info",             // debug | info | warn | error
      "maxIoChars": 0              // LLM IOログの上限文字数(0=無制限)
    }
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

- **状態・要約**: SQLite `data/<channel>/signalseeker.db`。`(source_id, item_key)` で記事を管理し、
  `content_hash` の変化で更新を検知。**要約も含めて永続化**するため、レポート・Wikiで再利用され、
  同一記事の再要約を避けます。`reported` で配信済みを管理(dry実行は未配信のまま繰り越し)。
- **レポート**: `data/<channel>/reports/`(人間が読む用)。
- **Wiki**: `data/<channel>/wiki/`(Obsidian vault、下記)。

## Wiki(Obsidian)

蓄積データを **Obsidian で開ける Markdown ナレッジベース**として `data/<channel>/wiki/` に生成します。本実行・dry実行の
両方で(要約済みデータから)再生成され、`npm run wiki -- --channel=<id>` で単体再生成も可能です。Obsidian でこのフォルダを
vault として開けば、**全文検索・タグ絞り込み・グラフ表示**がそのまま使えます。

```
data/<channel>/wiki/
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

## 週次相当レポート(最大15日)

新しい取得はせず、**手元に溜まっているデータ**から一定期間を振り返って整理するレポートです。基準は「今から
7日」ではなく、**最後に集めたデータからさかのぼってN日**です(既定7日)。期間は指定でき、**最大15日**まで
広げられます。月次はまだありません(月次は別の見方になるため分けています)。

```bash
npm run weekly -- --channel=ai-tech                       # 最後の収集日から過去7日分(既定)
npm run weekly -- --channel=ai-tech --days=15             # 過去15日分(最大)
npm run weekly -- --channel=ai-tech --until=2026-06-20    # 終了日を指定(その日まで)。--days と併用可
npm run weekly -- --channel=ai-tech --until=2026-06-20 --days=10
```

- 期間の区切りは**記事を集めた日(収集日)**を基準にします。
- 出力: `data/<channel>/reports/report-weekly-<終了日>-<日数>d.md`(本文)と同名の `.json`(再描画用データ)。
- コマンドの最後に、HTML 化のためのコマンドが案内として表示されます。
- `--days` は 1〜15 の範囲です(範囲外はエラーになります)。

### 週次レポートを HTML にする

週次レポートの HTML 化は、下の「HTML インフォグラフィック」と同じコマンドに、案内された見出しラベルを渡すだけです。

```bash
npm run infographic -- --channel=ai-tech --label=weekly-2026-06-24-7d              # HTML化(Discordにも送付)
npm run infographic -- --channel=ai-tech --label=weekly-2026-06-24-7d --no-discord # 送らずファイルだけ
```

## HTML インフォグラフィック

レポートと同じ内容を、**見やすいダーク・ダッシュボード**の HTML に整形する独立コマンドです。収集・要約・送付
とは切り離されており、「見栄え・読みやすさを上げたいときだけ」実行できます。`npm run crawl` のたびにレポートの
素データ(スナップショット)が `data/<channel>/reports/report-<実行ラベル>.json` に保存されるので、それを元に何度でも
再描画できます(収集・要約のやり直しは不要)。

```bash
npm run infographic -- --channel=ai-tech                 # 直近のレポートを HTML 化(既定 --latest)
npm run infographic -- --channel=ai-tech --run=128       # 実行ID(run-id)を指定して過去回を再描画
npm run infographic -- --channel=ai-tech --label=<実行ラベル>  # 実行ラベルを指定
npm run infographic -- --channel=ai-tech --no-discord    # Discord へは送らずファイル生成だけ
```

- 出力: `data/<channel>/reports/report-<実行ラベル>.html`。ブラウザで開くだけで表示できます(外部ファイル不要の自己完結HTML)。
- **Discord にも送付**します: チャンネルの `notify.targets` に `discord` があり、そのチャンネルの webhook
  (`notify.discordWebhookEnv` で指定した `.env` の変数)が設定されていれば、生成した HTML を添付ファイルとして
  送ります。送りたくないときは `--no-discord` を付けてください。
- run-id は、レポート見出し、`npm run db -- --channel=<id> runs`、`npm run crawl` の実行ログで確認できます。
- 引数は **`--run=128` のように `=` でつなぐ**形式を使ってください(`npm run … -- --run 128` の空白区切りは
  npm に取り込まれて渡らないため)。
- 見た目のテーマは固定で、毎回同じデザインになります。

## 運用・開発者向けツール

### ログ(不具合解析)

`data/logs/` に実行ごとの構造化ログを残します。

- `data/logs/run-<timestamp>.jsonl` — 実行の各イベント(収集結果・要約・通知・Wiki・エラー)を1行JSONで。
- `data/logs/llm/<timestamp>-<n>.json` — **生成AI呼び出しごとの INPUT(system+messages)/OUTPUT/usage/所要ms/error を全文保存**。
  原因分析時はこのファイルで実際のプロンプトと応答を確認できます(`runtime.logging.maxIoChars` で上限可)。
- 実行開始時にログのパスを表示します。`level` で詳細度を調整。

### 中断からの再開

要約結果は1件ごとに DB へ即時保存されるため、途中でクラッシュしても**再実行で未処理分だけ続行**します。

- `npm run crawl:resume` … 収集をスキップし、DB の未要約・未配信分から再開(収集済みデータを無駄にしない)。
- 起動時に前回の未完了実行(`status=running` のまま終了)を検出し警告します。`runs` テーブルに
  `running / completed / failed / interrupted` の状態を記録(`npm run db -- runs` で確認)。

### DB閲覧 `npm run db`

```bash
npm run db -- --channel=ai-tech stats                       # 集計(総数・要約済・未配信・カテゴリ/ソース別)
npm run db -- --channel=ai-tech items --needing --limit 20  # 未要約の記事(--source ID / --pending / --reported)
npm run db -- --channel=ai-tech runs                        # 実行履歴(status/時間/ログパス/エラー)
npm run db -- --channel=ai-tech search <キーワード>          # タイトル/要約/本文の全文(LIKE)検索
npm run db -- --channel=ai-tech item <sourceId> <itemKey>   # 1件の詳細(要約・本文込み)
```

### 設定メンテナンス `npm run config`

対象チャンネルの `config.json` と `sources.json` を編集します。`--channel=<id>` のみで**対話メニュー**、
サブコマンドを付けると**非対話**で実行します。

```bash
npm run config -- --channel=ai-tech                       # 対話メニュー(ソース追加もこちら)
npm run config -- --channel=ai-tech show                  # 現在の設定 + ソース一覧
npm run config -- --channel=ai-tech get runtime.http.llmChatTimeoutMs
npm run config -- --channel=ai-tech set collect.maxContentChars 8000   # 値は数値/真偽/JSON/文字列を自動判別
npm run config -- --channel=ai-tech source list
npm run config -- --channel=ai-tech source enable <id> | disable <id> | remove <id>
npm run config -- --channel=ai-tech source set <id> <field> <value>
```

`set` は保存後に妥当性を検証します。

## 注意点

- 概要化に**低速なローカル reasoning モデル**を使う場合、1記事あたり数分かかることがあります
  (`openai-compat` のタイムアウトは10分)。`firstRunLimit` を下げる、量子化モデルを使う等で調整してください。
- Claude のプロンプトキャッシュは Haiku 4.5 で最小 4096 トークンが必要です。System プロンプトが
  短いとキャッシュは無効化されます(害はありませんが、コスト削減効果は出ません)。
- `html` 型はサイト構造の変更でセレクタが効かなくなることがあります。その場合は `selector` を調整してください。
