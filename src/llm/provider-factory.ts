// lllmAgents の provider-factory.ts を模倣。endpoint.providerType で cloud/local を切替。
import type { LLMEndpoint, RuntimeConfig } from "../types.js";
import type { LLMProvider } from "./base-provider.js";
import { AnthropicProvider } from "./anthropic.js";
import { OpenAICompatProvider } from "./openai-compat.js";

/** プロバイダに渡すタイムアウト(config.runtime.http 由来)。 */
export interface ProviderTimeouts {
  chatTimeoutMs: number;
  testTimeoutMs: number;
}

export function timeoutsFromRuntime(runtime: RuntimeConfig): ProviderTimeouts {
  return {
    chatTimeoutMs: runtime.http.llmChatTimeoutMs,
    testTimeoutMs: runtime.http.llmTestTimeoutMs,
  };
}

export function createProvider(ep: LLMEndpoint, timeouts: ProviderTimeouts): LLMProvider {
  if (ep.providerType === "anthropic") {
    return new AnthropicProvider(ep, timeouts); // cloud
  }
  // ollama / lmstudio / llamacpp / vllm は OpenAI互換で一括
  return new OpenAICompatProvider(ep, timeouts);
}
