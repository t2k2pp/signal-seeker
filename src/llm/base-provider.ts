// lllmAgents の providers/base-provider.ts を模倣したスリム版。
// chat() がストリームを返し、collectResponse() で1本の文字列に畳む(単発要約に最適)。
import type { ProviderType } from "../types.js";

export interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatParams {
  model: string;
  messages: Message[];
  /** system プロンプト(messages とは別に渡す。provider 側で適切に組み込む)。 */
  system?: string;
  maxTokens?: number;
}

export interface TokenUsage {
  promptTokens?: number;
  completionTokens?: number;
}

export interface ChatChunk {
  type: "text" | "done" | "error";
  text?: string;
  error?: string;
  /** done チャンクに付与されるトークン使用量(取得できた場合)。 */
  usage?: TokenUsage;
}

export interface LLMProvider {
  readonly providerType: ProviderType;
  /** 接続確認(モデル一覧やヘルスエンドポイント)。 */
  testConnection(): Promise<boolean>;
  chat(params: ChatParams): AsyncGenerator<ChatChunk>;
}

export interface CollectedResponse {
  text: string;
  usage?: TokenUsage;
}

/** ストリームを最後まで読み、text と usage を返す。error チャンクで例外を投げる。 */
export async function collectResponse(gen: AsyncGenerator<ChatChunk>): Promise<CollectedResponse> {
  let out = "";
  let usage: TokenUsage | undefined;
  for await (const chunk of gen) {
    if (chunk.type === "text") out += chunk.text ?? "";
    else if (chunk.type === "done") usage = chunk.usage ?? usage;
    else if (chunk.type === "error") throw new Error(chunk.error ?? "LLM error");
  }
  return { text: out.trim(), usage };
}
