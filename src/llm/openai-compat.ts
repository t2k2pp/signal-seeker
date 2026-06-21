// ローカルLLM共通プロバイダ。ollama/lmstudio/llamacpp/vllm はいずれも
// OpenAI互換の /v1/chat/completions を提供するため、1実装で一括対応する。
// 別プロバイダなので fetch 直叩き(Claude SDK とは混在させない)。
import type { LLMEndpoint, ProviderType } from "../types.js";
import type { ChatChunk, ChatParams, LLMProvider } from "./base-provider.js";
import type { ProviderTimeouts } from "./provider-factory.js";

const DEFAULT_BASE_URL: Partial<Record<ProviderType, string>> = {
  ollama: "http://localhost:11434/v1",
  lmstudio: "http://localhost:1234/v1",
  // llamacpp / vllm は起動ポートが可変なので config の baseUrl 指定を必須とする
};

export class OpenAICompatProvider implements LLMProvider {
  readonly providerType: ProviderType;
  private baseUrl: string;
  private model: string;
  private timeouts: ProviderTimeouts;

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
          stream: false,
        }),
        signal: AbortSignal.timeout(this.timeouts.chatTimeoutMs),
      });
      if (!res.ok) {
        yield { type: "error", error: `HTTP ${res.status} ${await res.text()}` };
        return;
      }
      const data = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const text = data.choices?.[0]?.message?.content ?? "";
      yield { type: "text", text };
      yield {
        type: "done",
        usage: {
          promptTokens: data.usage?.prompt_tokens,
          completionTokens: data.usage?.completion_tokens,
        },
      };
    } catch (err) {
      yield { type: "error", error: (err as Error).message };
    }
  }
}
