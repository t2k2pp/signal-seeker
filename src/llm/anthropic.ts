// Anthropic Messages API プロバイダ。skill 準拠で公式 SDK (@anthropic-ai/sdk) を使用。
import Anthropic from "@anthropic-ai/sdk";
import type { LLMEndpoint, ProviderType } from "../types.js";
import type { ChatChunk, ChatParams, LLMProvider } from "./base-provider.js";
import { resolveApiKey } from "./credentials.js";

export class AnthropicProvider implements LLMProvider {
  readonly providerType: ProviderType = "anthropic";
  private client: Anthropic;
  private model: string;

  constructor(ep: LLMEndpoint) {
    const apiKey = resolveApiKey(ep.apiKey ?? "env:ANTHROPIC_API_KEY");
    if (!apiKey) {
      throw new Error(
        "ANTHROPIC_API_KEY が見つかりません。.env に設定するか config の apiKey を指定してください。",
      );
    }
    this.client = new Anthropic({ apiKey });
    this.model = ep.model;
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.client.models.retrieve(this.model);
      return true;
    } catch {
      return false;
    }
  }

  async *chat(params: ChatParams): AsyncGenerator<ChatChunk> {
    try {
      const stream = this.client.messages.stream({
        model: params.model || this.model,
        max_tokens: params.maxTokens ?? 2000,
        // System は cache_control 付きで渡す(繰り返し呼び出しのコスト削減。
        // ただし Haiku は最小4096トークン未満だとキャッシュ無効 = 害なし)。
        ...(params.system
          ? { system: [{ type: "text" as const, text: params.system, cache_control: { type: "ephemeral" as const } }] }
          : {}),
        messages: params.messages.map((m) => ({
          role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
          content: m.content,
        })),
      });

      for await (const event of stream) {
        if (
          event.type === "content_block_delta" &&
          event.delta.type === "text_delta"
        ) {
          yield { type: "text", text: event.delta.text };
        }
      }
      yield { type: "done" };
    } catch (err) {
      yield { type: "error", error: (err as Error).message };
    }
  }
}
