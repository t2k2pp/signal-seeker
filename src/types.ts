// SignalSeeker 共通型定義

/**
 * 訪問先の種別。省略時は収集側が自動判定する(GitHub→release, フィード発見→rss, それ以外→html)。
 * 特定URLに特化させないため、通常は指定不要。
 */
export type SourceType = "rss" | "html" | "github_release";

/** config/sources.json の1エントリ。別ツールで保守し、本アプリは読み取るのみ。 */
export interface Source {
  id: string;
  name: string;
  /** サイトURL。フィードURLでもサイトトップでも可(フィードは自動発見する)。 */
  url: string;
  /** 省略可。指定が無ければ url から戦略を自動判定する。 */
  type?: SourceType;
  category: string;
  /** 任意: フィードURLを明示するとフィード自動発見をスキップ(高速化)。 */
  feedUrl?: string;
  /** 任意(html): 一覧リンク抽出の CSS セレクタ。無ければ汎用ヒューリスティックで抽出。 */
  selector?: string;
  /** 任意: 1ソースから取得する最大件数 (既定 20)。 */
  maxLinks?: number;
  enabled: boolean;
}

/** 収集された1記事。content_hash で前回との差分を判定する。 */
export interface Item {
  sourceId: string;
  /** 一意キー。URL があれば URL、無ければ正規化タイトル。 */
  itemKey: string;
  title: string;
  url: string;
  publishedAt: string | null;
  /** タイトル+本文の SHA-256。変化したら「更新」とみなす。 */
  contentHash: string;
  rawText: string;
}

/** レポートでの記事の状態。new=今回新規 / updated=本文更新 / carried=過去のdry実行からの繰越。 */
export type ItemState = "new" | "updated" | "carried";

/**
 * 「現地での注目度」シグナル。取得元ごとに得られるものだけ埋まる(無いものは undefined)。
 * これらは重要度スコアの材料にし、レポートにも併記する。
 */
export interface AttentionMetrics {
  /** Hugging Face Papers の upvote 数(arXiv論文がHF上にページを持つ場合)。 */
  hfUpvotes?: number;
  /** Semantic Scholar の引用数(主に既存論文向け。新着はほぼ0)。 */
  citationCount?: number;
  /** GitHub リポジトリの star 数(リポジトリ全体の人気)。 */
  ghStars?: number;
  /** GitHub リリースへの reaction 合計(そのリリース個別への反応)。 */
  ghReactions?: number;
  /** GitHub リリースが prerelease(RC等)か。重要度の減点に使う。 */
  prerelease?: boolean;
  /** 注目度取得を試みた時刻(ISO)。未取得(null)と「取得したが何も無い」を区別する。 */
  fetchedAt?: string;
}

/** 要約付きの記事(レポート・Wikiで使う)。 */
export interface SummarizedItem extends Item {
  sourceName: string;
  category: string;
  /** 生成AIによる客観ファクト要約 (Markdown 箇条書き)。未取得は null。 */
  summary: string | null;
  state: ItemState;
  /** 「現地での注目度」シグナル(取得済みなら)。 */
  attention?: AttentionMetrics | null;
  /** レポート生成時に算出した重要度スコア(0..1目安、降順に並べる)。 */
  score?: number;
}

/** DB に永続化された記事1行(Wiki/再利用の基盤)。 */
export interface StoredItem extends Item {
  sourceName: string;
  category: string;
  summary: string | null;
  /** 本実行でレポート配信済みなら true。dry実行では false のまま繰り越す。 */
  reported: boolean;
  /** 「現地での注目度」シグナル(取得済みなら)。 */
  attention?: AttentionMetrics | null;
  firstSeenAt: string;
  lastSeenAt: string;
}

// ---- LLM (lllmAgents のプロバイダ抽象を模倣) ----

export type ProviderType = "anthropic" | "ollama" | "lmstudio" | "llamacpp" | "vllm";

/** プロバイダ切替のための endpoint 設定。Claude→ローカルは config の差し替えだけ。 */
export interface LLMEndpoint {
  providerType: ProviderType;
  model: string;
  /** ローカル系のみ: OpenAI互換ベースURL (例 http://localhost:11434/v1)。 */
  baseUrl?: string;
  /** "env:NAME" で環境変数解決、それ以外は平文。未指定なら provider 既定。 */
  apiKey?: string;
}

// ---- アプリ設定 ----

export type NotifyTarget = "console" | "discord";

/** 収集動作の設定。 */
export interface CollectConfig {
  /** 1記事あたり保持・要約に渡す最大文字数 (既定 8000)。 */
  maxContentChars: number;
  /** 各記事ページの本文も取得するか (html、および本文が薄いRSS記事の補完。既定 true)。 */
  fetchArticleBody: boolean;
  /** RSS本文がこの文字数未満なら記事ページ本文で補完する (0=補完しない。既定 400)。 */
  articleBodyMinChars: number;
  /** 同一ホストへの連続アクセスの最小間隔(ms)。レート制限(Reddit等)対策。0=無効。既定 4000。 */
  perHostMinIntervalMs: number;
}

/** Obsidian Wiki 出力設定 (lllmAgents の ObsidianConfig 流儀)。 */
export interface WikiConfig {
  enabled: boolean;
  /** vault の絶対 or プロジェクト相対パス (既定 "data/wiki")。 */
  vaultPath: string;
  /** 全ノートに付与する既定タグ (既定 ["signalseeker"])。 */
  defaultTags?: string[];
}

/**
 * キュレーション(重要度ランキング・注目度・集約)の設定。
 * 重みや係数は「閾値」ではなく挙動の調整なので runtime ではなくここに置く。
 */
export interface CurationConfig {
  /** 重要度スコアでレポート/Wikiを並べ替えるか。 */
  rankByScore: boolean;
  /** 同一リリース系列(rc等)や近接重複を集約するか。 */
  groupReleaseSeries: boolean;
  /** 注目度シグナルの外部取得を有効化するか。 */
  enrichAttention: boolean;
  /** 個別シグナルの取得 ON/OFF。 */
  sources: {
    /** Hugging Face Papers upvote(arXiv論文、認証不要)。 */
    hfPapers: boolean;
    /** Semantic Scholar 引用数(S2_API_KEY 無しだと429になりやすい)。 */
    semanticScholar: boolean;
    /** GitHub star/reaction/prerelease(無認証可、GITHUB_TOKEN で上限緩和)。 */
    github: boolean;
  };
  /** 注目度取得1回あたりのHTTPタイムアウト(ms)。 */
  fetchTimeoutMs: number;
  /** スコア重み(各シグナルを0..1に正規化した値へ掛ける)。 */
  weights: {
    /** 鮮度(新しさ)。 */
    recency: number;
    /** 注目度(upvote/引用/reaction等)。 */
    attention: number;
    /** 内容(破壊的変更ありで加点、ファクト無しで0)。 */
    content: number;
  };
  /** 鮮度スコアの半減日数(この日数で鮮度が半分になる指数減衰)。 */
  recencyHalfLifeDays: number;
  /** prerelease や「ファクト無し」記事に掛ける減点係数(0..1、小さいほど降格)。 */
  demoteFactor: number;
}

export type LogLevel = "debug" | "info" | "warn" | "error";

/** タイムアウト等の閾値・ログ設定。ハードコードせず config に集約。 */
export interface RuntimeConfig {
  http: {
    /** LLM chat 応答のタイムアウト(ms)。ローカル低速モデル向けに大きめ可。 */
    llmChatTimeoutMs: number;
    /** LLM 接続確認のタイムアウト(ms)。 */
    llmTestTimeoutMs: number;
    /** RSS/Atom 取得のタイムアウト(ms)。 */
    rssTimeoutMs: number;
    /** Discord webhook のタイムアウト(ms)。 */
    discordTimeoutMs: number;
    /** Discord 429 リトライ時、retry-after(秒) に掛ける単位(ms)。標準は1000。 */
    discordRetryUnitMs: number;
  };
  playwright: {
    /** 一覧ページ goto のタイムアウト(ms)。 */
    navTimeoutMs: number;
    /** 記事ページ本文取得 goto のタイムアウト(ms)。 */
    articleTimeoutMs: number;
  };
  summarize: {
    /** 要約の最大出力トークン数。reasoning モデルは推論にも消費するため大きめ推奨。 */
    maxOutputTokens: number;
    /** 1記事の要約失敗時に再試行する最大回数 (0=リトライなし)。 */
    maxRetries: number;
    /** リトライ間隔の基準(ms)。指数バックオフ base*2^(attempt-1) で待機。 */
    retryBackoffMs: number;
  };
  logging: {
    /** ログ出力ディレクトリ(相対 or 絶対、既定 "data/logs")。 */
    dir: string;
    /** コンソール出力の最小レベル。 */
    level: LogLevel;
    /** LLM IO ログの最大文字数 (0=無制限)。 */
    maxIoChars: number;
  };
}

export interface AppConfig {
  llm: {
    endpoint: LLMEndpoint;
    /** 重要記事の深掘り用 (未指定なら endpoint を流用)。 */
    deepEndpoint?: LLMEndpoint;
  };
  notify: { targets: NotifyTarget[] };
  /** 初回実行時、source毎に取り込む最大件数 (差分ノイズ抑制)。 */
  firstRunLimit: number;
  collect: CollectConfig;
  curation: CurationConfig;
  wiki: WikiConfig;
  runtime: RuntimeConfig;
}

/** 1回の実行結果サマリ。 */
export interface RunResult {
  startedAt: string;
  finishedAt: string;
  summarized: SummarizedItem[];
  errors: { sourceId: string; message: string }[];
}
