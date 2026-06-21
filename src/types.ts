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

/** 差分(新規 or 更新)と判定された Item に要約を付与したもの。 */
export interface SummarizedItem extends Item {
  sourceName: string;
  category: string;
  /** 生成AIによる客観ファクト要約 (Markdown 箇条書き)。失敗時は null。 */
  summary: string | null;
  /** 新規(true) か 更新(false) か。 */
  isNew: boolean;
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

export interface AppConfig {
  llm: {
    endpoint: LLMEndpoint;
    /** 重要記事の深掘り用 (未指定なら endpoint を流用)。 */
    deepEndpoint?: LLMEndpoint;
  };
  notify: { targets: NotifyTarget[] };
  /** 初回実行時、source毎に取り込む最大件数 (差分ノイズ抑制)。 */
  firstRunLimit: number;
}

/** 1回の実行結果サマリ。 */
export interface RunResult {
  startedAt: string;
  finishedAt: string;
  summarized: SummarizedItem[];
  errors: { sourceId: string; message: string }[];
}
