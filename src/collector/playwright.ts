import { chromium, type Browser } from "playwright";
import type { Item, Source } from "../types.js";
import { hashContent } from "../db.js";

export interface HtmlCollectOptions {
  limit: number;
  maxContentChars: number;
  /** 各記事ページを開いて本文も取得するか。 */
  fetchArticleBody: boolean;
}

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
   * html 型ソースを巡回。selector で一覧リンクを抽出し、各リンクを Item 化する。
   * fetchArticleBody=true なら各記事ページを開き本文(main/article/body)を maxContentChars まで取得。
   */
  async collectHtml(source: Source, opts: HtmlCollectOptions): Promise<Item[]> {
    const browser = await this.ensure();
    const page = await browser.newPage();
    try {
      await page.goto(source.url, { waitUntil: "domcontentloaded", timeout: 30000 });
      const selector = source.selector ?? "a";
      const links = await page.$$eval(selector, (els) =>
        (els as HTMLAnchorElement[]).map((el) => ({
          text: (el.textContent ?? "").replace(/\s+/g, " ").trim(),
          href: el.href,
        })),
      );

      const seen = new Set<string>();
      const picked: { text: string; href: string }[] = [];
      for (const link of links) {
        if (!link.href || !link.text || link.text.length < 8) continue;
        if (seen.has(link.href)) continue;
        seen.add(link.href);
        picked.push(link);
        if (picked.length >= opts.limit) break;
      }

      const items: Item[] = [];
      for (const link of picked) {
        let body = link.text;
        if (opts.fetchArticleBody) {
          const fetched = await this.fetchBody(browser, link.href, opts.maxContentChars);
          if (fetched) body = fetched;
        }
        items.push({
          sourceId: source.id,
          itemKey: link.href,
          title: link.text,
          url: link.href,
          publishedAt: null,
          contentHash: hashContent(link.text, body),
          rawText: body.slice(0, opts.maxContentChars),
        });
      }
      return items;
    } finally {
      await page.close();
    }
  }

  /** 記事ページを開き、本文らしき要素のテキストを取得する。失敗時は null。 */
  private async fetchBody(browser: Browser, url: string, maxChars: number): Promise<string | null> {
    const page = await browser.newPage();
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });
      const text = await page.evaluate(() => {
        const pick = (sel: string): string => {
          const el = document.querySelector(sel) as HTMLElement | null;
          return el?.innerText ?? "";
        };
        // 本文らしい要素を優先順に試し、無ければ body 全体
        const candidate = pick("article") || pick("main") || pick('[role="main"]') || document.body.innerText;
        return candidate.replace(/\s+/g, " ").trim();
      });
      return text ? text.slice(0, maxChars) : null;
    } catch {
      return null;
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
