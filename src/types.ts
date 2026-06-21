// SignalSeeker 共通型定義

/** 訪問先の種別。リストを変えることで取得する情報を変える唯一のレバー。 */
export type SourceType = "rss" | "html" | "github_release";

/** config/sources.json の1エントリ。別ツールで保守し、本アプリは読み取るのみ。 */
export interface Source {
  id: string;
  name: string;
  url: string;
  type: SourceType;
  category: string;
  /** html型のみ: 一覧リンクを抽出する CSS セレクタ */
  selector?: string;
  /** html型のみ: 1ソースから取得する最大リンク数 (既定 20) */
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

/** 要約付きの記事(レポート・Wikiで使う)。 */
export interface SummarizedItem extends Item {
  sourceName: string;
  category: string;
  /** 生成AIによる客観ファクト要約 (Markdown 箇条書き)。未取得は null。 */
  summary: string | null;
  state: ItemState;
}

/** DB に永続化された記事1行(Wiki/再利用の基盤)。 */
export interface StoredItem extends Item {
  sourceName: string;
  category: string;
  summary: string | null;
  /** 本実行でレポート配信済みなら true。dry実行では false のまま繰り越す。 */
  reported: boolean;
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
  /** html型で各記事ページの本文も取得するか (既定 true)。 */
  fetchArticleBody: boolean;
}

/** Obsidian Wiki 出力設定 (lllmAgents の ObsidianConfig 流儀)。 */
export interface WikiConfig {
  enabled: boolean;
  /** vault の絶対 or プロジェクト相対パス (既定 "data/wiki")。 */
  vaultPath: string;
  /** 全ノートに付与する既定タグ (既定 ["signalseeker"])。 */
  defaultTags?: string[];
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
