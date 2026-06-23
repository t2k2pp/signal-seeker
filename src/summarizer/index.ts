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

出力言語のルール:
- 出力は必ず日本語で書くこと。原文が英語でも、説明文・本文は日本語に翻訳して記述する。
- ただし次のものは翻訳せず原文のまま残すこと: 固有名詞、製品名・サービス名・モデル名、
  OSS名・ライブラリ名・API名、コードやコマンド・識別子、バージョン番号、正式名称・規格名。
- 英単語をカタカナに無理に置き換えず、上記に当たる語はそのまま表記する。

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
          provider.chat({ model: config.llm.endpoint.model, system: SYSTEM_PROMPT, messages, maxTokens: maxOutputTokens }),
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
        system: SYSTEM_PROMPT,
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
