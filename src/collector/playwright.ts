import { chromium, type Browser } from "playwright";
import type { Item, Source } from "../types.js";
import { hashContent } from "../db.js";

/** 複数ソースで1つのブラウザを使い回すためのハンドル。 */
export class BrowserSession {
  private browser: Browser | null = null;

  private async ensure(): Promise<Browser> {
    if (!this.browser) {
      this.browser = await chromium.launch({ headless: true });
    }
    return this.browser;
  }

  /**
   * html 型ソースを巡回。selector で一覧リンクを抽出し、各リンクのタイトル+href を Item 化する。
   * 本文は一覧ページのリンクテキストを暫定本文として用いる(個別ページの本文取得は将来拡張)。
   */
  async collectHtml(source: Source, limit: number): Promise<Item[]> {
    const browser = await this.ensure();
    const page = await browser.newPage();
    try {
      await page.goto(source.url, { waitUntil: "domcontentloaded", timeout: 30000 });
      const selector = source.selector ?? "a";
      const links = await page.$$eval(
        selector,
        (els) =>
          (els as HTMLAnchorElement[]).map((el) => ({
            text: (el.textContent ?? "").replace(/\s+/g, " ").trim(),
            href: el.href,
          })),
      );

      const seen = new Set<string>();
      const items: Item[] = [];
      for (const link of links) {
        if (!link.href || !link.text || link.text.length < 8) continue;
        if (seen.has(link.href)) continue;
        seen.add(link.href);
        items.push({
          sourceId: source.id,
          itemKey: link.href,
          title: link.text,
          url: link.href,
          publishedAt: null,
          contentHash: hashContent(link.text, link.href),
          rawText: link.text,
        });
        if (items.length >= limit) break;
      }
      return items;
    } finally {
      await page.close();
    }
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}
