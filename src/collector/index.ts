import type { Item, Source } from "../types.js";
import { collectRss } from "./rss.js";
import { BrowserSession } from "./playwright.js";

export interface CollectResult {
  items: Item[];
  errors: { sourceId: string; message: string }[];
}

/**
 * 全ソースを source.type で分岐して巡回し、Item[] をまとめて返す。
 * html 型がある場合のみブラウザを起動し、最後に閉じる。
 */
export async function collectAll(sources: Source[], perSourceLimit: number): Promise<CollectResult> {
  const items: Item[] = [];
  const errors: { sourceId: string; message: string }[] = [];
  const browser = new BrowserSession();

  try {
    for (const source of sources) {
      try {
        const collected =
          source.type === "html"
            ? await browser.collectHtml(source, source.maxLinks ?? perSourceLimit)
            : await collectRss(source, perSourceLimit);
        items.push(...collected);
        console.log(`  [collect] ${source.id}: ${collected.length}件`);
      } catch (err) {
        const message = (err as Error).message;
        errors.push({ sourceId: source.id, message });
        console.warn(`  [collect] ${source.id}: 失敗 — ${message}`);
      }
    }
  } finally {
    await browser.close();
  }

  return { items, errors };
}
