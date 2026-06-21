import type { AppConfig, Item, Source, SummarizedItem } from "../types.js";
import type { ItemDiff } from "../db.js";
import { createProvider } from "../llm/provider-factory.js";
import { collectResponse } from "../llm/base-provider.js";

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

/** Item → LLM に渡すテキスト。 */
function itemToText(item: Item): string {
  return [`タイトル: ${item.title}`, `URL: ${item.url}`, item.rawText ? `内容: ${item.rawText}` : ""]
    .filter(Boolean)
    .join("\n");
}

/**
 * 差分 Item 群を要約する。config.llm.endpoint のプロバイダで処理し、
 * 失敗は item 単位で握って summary=null とし、全体は止めない。
 */
export async function summarizeDiffs(
  diffs: ItemDiff[],
  sources: Source[],
  config: AppConfig,
): Promise<SummarizedItem[]> {
  const provider = createProvider(config.llm.endpoint);
  const sourceMap = new Map(sources.map((s) => [s.id, s]));
  const results: SummarizedItem[] = [];

  for (const diff of diffs) {
    const item = diff.item;
    const source = sourceMap.get(item.sourceId);
    let summary: string | null = null;
    try {
      summary = await collectResponse(
        provider.chat({
          model: config.llm.endpoint.model,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: itemToText(item) }],
          maxTokens: 2000,
        }),
      );
    } catch (err) {
      console.warn(`  [summarize] ${item.sourceId}/${item.title}: 失敗 — ${(err as Error).message}`);
    }
    results.push({
      ...item,
      sourceName: source?.name ?? item.sourceId,
      category: source?.category ?? "未分類",
      summary,
      isNew: diff.kind === "new",
    });
  }
  return results;
}
