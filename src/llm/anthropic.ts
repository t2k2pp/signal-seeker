// Anthropic Messages API プロバイダ。skill 準拠で公式 SDK (@anthropic-ai/sdk) を使用。
import Anthropic from "@anthropic-ai/sdk";
import type { LLMEndpoint, ProviderType } from "../types.js";
import type { ChatChunk, ChatParams, LLMProvider } from "./base-provider.js";
import type { ProviderTimeouts } from "./provider-factory.js";
import { resolveApiKey } from "./credentials.js";

export class AnthropicProvider implements LLMProvider {
  readonly providerType: ProviderType = "anthropic";
  private client: Anthropic;
  private model: string;
  private timeouts: ProviderTimeouts;

  constructor(ep: LLMEndpoint, timeouts: ProviderTimeouts) {
    const apiKey = resolveApiKey(ep.apiKey ?? "env:ANTHROPIC_API_KEY");
    if (!apiKey) {
      throw new Error(
        "ANTHROPIC_API_KEY が見つかりません。.env に設定するか config の apiKey を指定してください。",
      );
    }
    this.timeouts = timeouts;
    this.client = new Anthropic({ apiKey, timeout: timeouts.chatTimeoutMs });
    this.model = ep.model;
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.client.withOptions({ timeout: this.timeouts.testTimeoutMs }).models.retrieve(this.model);
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
        ...(params.system
          ? { system: [{ type: "text" as const, text: params.system, cache_control: { type: "ephemeral" as const } }] }
          : {}),
        messages: params.messages.map((m) => ({
          role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
          content: m.content,
        })),
      });

      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          yield { type: "text", text: event.delta.text };
        }
      }
      const final = await stream.finalMessage();
      yield {
        type: "done",
        usage: {
          promptTokens: final.usage.input_tokens,
          completionTokens: final.usage.output_tokens,
        },
      };
    } catch (err) {
      const e = err as { message?: string; status?: number; error?: { error?: { message?: string } } };
      const detail = e.error?.error?.message ? ` (${e.error.error.message})` : "";
      yield { type: "error", error: `${e.message ?? String(err)}${e.status ? ` [HTTP ${e.status}]` : ""}${detail}` };
    }
  }
}
