// ローカルLLM共通プロバイダ。ollama/lmstudio/llamacpp/vllm はいずれも
// OpenAI互換の /v1/chat/completions を提供するため、1実装で一括対応する。
// 別プロバイダなので fetch 直叩き(Claude SDK とは混在させない)。
//
// 低速ローカルLLM対応の要:
//  - stream:true で逐次トークンを受信する。Node(undici)の bodyTimeout は
//    「チャンク間の無通信時間」で測るため、トークンが流れ続ける限り発火しない。
//  - さらに undici Agent の headersTimeout/bodyTimeout を chatTimeoutMs に明示設定し、
//    Node 内蔵の隠れた既定上限(300秒)を撤廃する。これで config の値が唯一の上限になる。
import { Agent } from "undici";
import type { LLMEndpoint, ProviderType } from "../types.js";
import type { ChatChunk, ChatParams, LLMProvider } from "./base-provider.js";
import type { ProviderTimeouts } from "./provider-factory.js";

const DEFAULT_BASE_URL: Partial<Record<ProviderType, string>> = {
  ollama: "http://localhost:11434/v1",
  lmstudio: "http://localhost:1234/v1",
  // llamacpp / vllm は起動ポートが可変なので config の baseUrl 指定を必須とする
};

/** fetch エラーの根本原因(undici の cause)まで文字列化する。"fetch failed" だけにしない。 */
export function describeFetchError(err: unknown): string {
  const e = err as { name?: string; message?: string; cause?: unknown };
  let msg = e?.message ?? String(err);
  const cause = e?.cause as { code?: string; message?: string } | undefined;
  if (cause && (cause.code || cause.message)) {
    msg += ` (cause: ${[cause.code, cause.message].filter(Boolean).join(" / ")})`;
  }
  return msg;
}

export class OpenAICompatProvider implements LLMProvider {
  readonly providerType: ProviderType;
  private baseUrl: string;
  private model: string;
  private timeouts: ProviderTimeouts;
  private dispatcher: Agent;

  constructor(ep: LLMEndpoint, timeouts: ProviderTimeouts) {
    this.providerType = ep.providerType;
    const base = ep.baseUrl ?? DEFAULT_BASE_URL[ep.providerType];
    if (!base) {
      throw new Error(
        `${ep.providerType} は baseUrl が必須です(例 http://localhost:8000/v1)。config.json の llm.endpoint.baseUrl を設定してください。`,
      );
    }
    this.baseUrl = base.replace(/\/+$/, "");
    this.model = ep.model;
    this.timeouts = timeouts;
    // headersTimeout: 最初のバイトまでの許容時間。bodyTimeout: チャンク間無通信の許容時間。
    // 両方を chatTimeoutMs に合わせ、Node 既定の 300 秒上限を撤廃する。
    this.dispatcher = new Agent({
      headersTimeout: timeouts.chatTimeoutMs,
      bodyTimeout: timeouts.chatTimeoutMs,
    });
  }

  async testConnection(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        signal: AbortSignal.timeout(this.timeouts.testTimeoutMs),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async *chat(params: ChatParams): AsyncGenerator<ChatChunk> {
    try {
      const messages = [
        ...(params.system ? [{ role: "system", content: params.system }] : []),
        ...params.messages.map((m) => ({ role: m.role, content: m.content })),
      ];
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: params.model || this.model,
          messages,
          max_tokens: params.maxTokens ?? 2000,
          stream: true,
          stream_options: { include_usage: true },
        }),
        signal: AbortSignal.timeout(this.timeouts.chatTimeoutMs),
        // @ts-expect-error: undici 拡張。Node 内蔵 fetch も dispatcher を受け付ける。
        dispatcher: this.dispatcher,
      });
      if (!res.ok || !res.body) {
        const detail = res.body ? await res.text() : "(no body)";
        yield { type: "error", error: `HTTP ${res.status} ${detail}` };
        return;
      }

      // SSE(text/event-stream)を行単位でパースし、delta.content を逐次 yield する。
      // reasoning モデルの reasoning_content は最終回答ではないため無視し content のみ採用。
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let usage: { promptTokens?: number; completionTokens?: number } | undefined;

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? ""; // 最後の未完行は次回へ持ち越し
        for (const raw of lines) {
          const line = raw.trim();
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (payload === "[DONE]") continue;
          let json: {
            choices?: { delta?: { content?: string } }[];
            usage?: { prompt_tokens?: number; completion_tokens?: number };
          };
          try {
            json = JSON.parse(payload);
          } catch {
            continue; // 不完全/非JSON行はスキップ(次チャンクで補完される)
          }
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) yield { type: "text", text: delta };
          if (json.usage) {
            usage = {
              promptTokens: json.usage.prompt_tokens,
              completionTokens: json.usage.completion_tokens,
            };
          }
        }
      }
      yield { type: "done", usage };
    } catch (err) {
      yield { type: "error", error: describeFetchError(err) };
    }
  }
}
