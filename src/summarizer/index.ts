import type { AppConfig, Item } from "../types.js";
import { createProvider, timeoutsFromRuntime } from "../llm/provider-factory.js";
import { collectResponse, type Message } from "../llm/base-provider.js";
import type { Logger } from "../logger.js";

/** サンプル指定のファクト抽出プロンプト(煽り排除・4観点の客観ファクトのみ)。 */
const SYSTEM_PROMPT = `あなたは技術情報の客観的ファクト抽出器です。
与えられた記事から、感情的な表現・誇張・煽りを完全に排除し、以下の4観点について
客観的なファクトのみを日本語の箇条書き(各行 "- " 始まり)で抽出してください。

1. 技術的仕様変更
2. アーキテクチャの提案
3. OSSの破壊的変更
4. 実運用上の課題

各観点に該当する事実が無ければその観点は省略してよい。
記事から確実に読み取れる事実のみを記載し、推測・意見・宣伝文句は含めないこと。
該当するファクトが一切無い場合は「- 抽出すべき技術的ファクトなし」とだけ出力すること。`;

export interface SummaryResult {
  sourceId: string;
  itemKey: string;
  summary: string | null;
}

function itemToText(item: Item): string {
  return [`タイトル: ${item.title}`, `URL: ${item.url}`, item.rawText ? `内容: ${item.rawText}` : ""]
    .filter(Boolean)
    .join("\n");
}

/**
 * 未要約の記事群を要約する。各 LLM 呼び出しの入出力・usage・所要msをログに残す。
 * 失敗は item 単位で握って summary=null とし、全体は止めない(逐次永続化で再開可能)。
 */
export async function summarizeItems(
  items: Item[],
  config: AppConfig,
  logger: Logger,
): Promise<SummaryResult[]> {
  const provider = createProvider(config.llm.endpoint, timeoutsFromRuntime(config.runtime));
  const results: SummaryResult[] = [];

  let i = 0;
  for (const item of items) {
    i++;
    const messages: Message[] = [{ role: "user", content: itemToText(item) }];
    const started = Date.now();
    let summary: string | null = null;
    let errMsg: string | undefined;
    let usage: { promptTokens?: number; completionTokens?: number } | undefined;

    console.log(`  [summarize ${i}/${items.length}] ${item.sourceId} / ${item.title.slice(0, 50)}`);
    try {
      const res = await collectResponse(
        provider.chat({ model: config.llm.endpoint.model, system: SYSTEM_PROMPT, messages, maxTokens: 2000 }),
      );
      summary = res.text || null;
      usage = res.usage;
    } catch (err) {
      errMsg = (err as Error).message;
      console.warn(`    失敗 — ${errMsg}`);
    }

    logger.logLlmCall({
      n: i,
      providerType: config.llm.endpoint.providerType,
      model: config.llm.endpoint.model,
      system: SYSTEM_PROMPT,
      messages,
      output: summary,
      usage,
      ms: Date.now() - started,
      error: errMsg,
      context: { sourceId: item.sourceId, itemKey: item.itemKey, title: item.title },
    });

    results.push({ sourceId: item.sourceId, itemKey: item.itemKey, summary });
  }
  return results;
}
