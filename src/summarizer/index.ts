import type { AppConfig, Item } from "../types.js";
import { createProvider, timeoutsFromRuntime } from "../llm/provider-factory.js";
import { collectResponse, type Message } from "../llm/base-provider.js";
import type { Logger } from "../logger.js";

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

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * 未要約の記事群を要約する。各 LLM 呼び出しの入出力・usage・所要msを試行ごとにログへ残す。
 * - その場リトライ: 失敗時は指数バックオフで maxRetries 回まで再試行する。
 * - 後で穴埋め: 最終的に失敗した記事は summary=null のまま返す。呼び出し側は
 *   これを reported 化しない(reported=0/summary=null)ため、次回実行で自動的に再要約される。
 */
export async function summarizeItems(
  items: Item[],
  config: AppConfig,
  logger: Logger,
  systemPrompt: string,
): Promise<SummaryResult[]> {
  const provider = createProvider(config.llm.endpoint, timeoutsFromRuntime(config.runtime));
  const { maxOutputTokens, maxRetries, retryBackoffMs } = config.runtime.summarize;
  const results: SummaryResult[] = [];

  let callNo = 0; // LLM 呼び出し通番(試行ごとに採番。ログファイル名の一意性に使う)
  let i = 0;
  for (const item of items) {
    i++;
    const messages: Message[] = [{ role: "user", content: itemToText(item) }];
    console.log(`  [summarize ${i}/${items.length}] ${item.sourceId} / ${item.title.slice(0, 50)}`);

    let summary: string | null = null;
    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      callNo++;
      const started = Date.now();
      let errMsg: string | undefined;
      let usage: { promptTokens?: number; completionTokens?: number } | undefined;
      try {
        const res = await collectResponse(
          provider.chat({ model: config.llm.endpoint.model, system: systemPrompt, messages, maxTokens: maxOutputTokens }),
        );
        summary = res.text || null;
        usage = res.usage;
      } catch (err) {
        errMsg = (err as Error).message;
      }

      logger.logLlmCall({
        n: callNo,
        providerType: config.llm.endpoint.providerType,
        model: config.llm.endpoint.model,
        system: systemPrompt,
        messages,
        output: summary,
        usage,
        ms: Date.now() - started,
        error: errMsg,
        context: {
          sourceId: item.sourceId,
          itemKey: item.itemKey,
          title: item.title,
          itemIndex: i,
          attempt,
          maxAttempts: maxRetries + 1,
        },
      });

      if (!errMsg) break; // 成功(summary が空でも成功扱い: モデルが「ファクトなし」を返した等)

      const last = attempt === maxRetries + 1;
      if (last) {
        console.warn(`    失敗(試行${attempt}/${maxRetries + 1}・最終) — ${errMsg}`);
        logger.warn("summarize_item_failed", {
          sourceId: item.sourceId, itemKey: item.itemKey, attempts: attempt, error: errMsg,
        });
      } else {
        const wait = retryBackoffMs * 2 ** (attempt - 1);
        console.warn(`    失敗(試行${attempt}/${maxRetries + 1}) — ${errMsg} → ${wait}ms 後に再試行`);
        await sleep(wait);
      }
    }

    results.push({ sourceId: item.sourceId, itemKey: item.itemKey, summary });
  }
  return results;
}
