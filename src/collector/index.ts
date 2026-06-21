import type { CollectConfig, Item, RuntimeConfig, Source } from "../types.js";
import { collectRss } from "./rss.js";
import { BrowserSession } from "./playwright.js";
import type { Logger } from "../logger.js";

export interface CollectResult {
  items: Item[];
  errors: { sourceId: string; message: string }[];
}

/**
 * 全ソースを source.type で分岐して巡回し、Item[] をまとめて返す。
 * html 型がある場合のみブラウザを起動し、最後に閉じる。各ソースの結果/失敗をログに残す。
 */
export async function collectAll(
  sources: Source[],
  perSourceLimit: number,
  collect: CollectConfig,
  runtime: RuntimeConfig,
  logger: Logger,
): Promise<CollectResult> {
  const items: Item[] = [];
  const errors: { sourceId: string; message: string }[] = [];
  const browser = new BrowserSession();

  try {
    for (const source of sources) {
      try {
        const collected =
          source.type === "html"
            ? await browser.collectHtml(source, {
                limit: source.maxLinks ?? perSourceLimit,
                maxContentChars: collect.maxContentChars,
                fetchArticleBody: collect.fetchArticleBody,
                navTimeoutMs: runtime.playwright.navTimeoutMs,
                articleTimeoutMs: runtime.playwright.articleTimeoutMs,
              })
            : await collectRss(source, perSourceLimit, collect.maxContentChars, runtime.http.rssTimeoutMs);
        items.push(...collected);
        logger.info("collect_source", { sourceId: source.id, type: source.type, count: collected.length });
      } catch (err) {
        const message = (err as Error).message;
        errors.push({ sourceId: source.id, message });
        logger.error("collect_source_failed", { sourceId: source.id, type: source.type, message });
      }
    }
  } finally {
    await browser.close();
  }

  return { items, errors };
}
