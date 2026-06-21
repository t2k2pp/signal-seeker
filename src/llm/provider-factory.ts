// lllmAgents の provider-factory.ts を模倣。endpoint.providerType で cloud/local を切替。
import type { LLMEndpoint } from "../types.js";
import type { LLMProvider } from "./base-provider.js";
import { AnthropicProvider } from "./anthropic.js";
import { OpenAICompatProvider } from "./openai-compat.js";

export function createProvider(ep: LLMEndpoint): LLMProvider {
  if (ep.providerType === "anthropic") {
    return new AnthropicProvider(ep); // cloud
  }
  // ollama / lmstudio / llamacpp / vllm は OpenAI互換で一括
  return new OpenAICompatProvider(ep);
}
