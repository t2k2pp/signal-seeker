import { chromium, type Browser } from "playwright";
import type { Item, Source } from "../types.js";
import { hashContent } from "../db.js";

export interface HtmlCollectOptions {
  limit: number;
  maxContentChars: number;
  /** 各記事ページを開いて本文も取得するか。 */
  fetchArticleBody: boolean;
  /** 一覧ページ goto のタイムアウト(ms)。 */
  navTimeoutMs: number;
  /** 記事ページ goto のタイムアウト(ms)。 */
  articleTimeoutMs: number;
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
      await page.goto(source.url, { waitUntil: "domcontentloaded", timeout: opts.navTimeoutMs });
      // セレクタ指定があればそれを使う。無ければ全 <a> を汎用ヒューリスティックで選別する。
      const selector = source.selector ?? "a";
      const links = await page.$$eval(selector, (els) =>
        (els as HTMLAnchorElement[]).map((el) => ({
          text: (el.textContent ?? "").replace(/\s+/g, " ").trim(),
          href: el.href,
        })),
      );

      // 同一サイト・十分な長さのリンク本文・一覧トップ自身は除外、で記事リンクらしきものに絞る。
      const pageUrl = new URL(source.url);
      const minTextLen = source.selector ? 8 : 18;
      const seen = new Set<string>();
      const picked: { text: string; href: string }[] = [];
      for (const link of links) {
        if (!link.href || !link.text || link.text.length < minTextLen) continue;
        let href: URL;
        try {
          href = new URL(link.href);
        } catch {
          continue;
        }
        if (href.protocol !== "http:" && href.protocol !== "https:") continue;
        // セレクタ未指定(汎用)時は同一ホストの、トップより深い階層のリンクのみ
        if (!source.selector) {
          if (href.host !== pageUrl.host) continue;
          if (href.pathname.replace(/\/+$/, "") === pageUrl.pathname.replace(/\/+$/, "")) continue;
          if (href.pathname === "/" || href.hash) continue;
        }
        const norm = href.href.split("#")[0]!;
        if (seen.has(norm)) continue;
        seen.add(norm);
        picked.push({ text: link.text, href: norm });
        if (picked.length >= opts.limit) break;
      }

      const items: Item[] = [];
      for (const link of picked) {
        let body = link.text;
        if (opts.fetchArticleBody) {
          const fetched = await this.fetchBody(browser, link.href, opts.maxContentChars, opts.articleTimeoutMs);
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

  /**
   * 記事ページを開き本文らしきテキストを取得する(汎用・サイト別セレクタ不要)。
   * RSS本文が薄い記事の補完にも使う。失敗時は null。
   */
  async fetchArticle(url: string, maxChars: number, timeoutMs: number): Promise<string | null> {
    const browser = await this.ensure();
    return this.fetchBody(browser, url, maxChars, timeoutMs);
  }

  /**
   * 記事ページを開き、本文らしき要素のテキストを取得する。失敗時は null。
   * JS描画のSPAでも本文を取れるよう、domcontentloaded 後に networkidle を待ってから抽出する
   * (networkidle に到達しないページもあるため、待機失敗時はそのまま抽出にフォールバックせず現状を読む)。
   */
  private async fetchBody(browser: Browser, url: string, maxChars: number, timeoutMs: number): Promise<string | null> {
    const page = await browser.newPage();
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
      // 描画完了を待つ(到達しなくても例外を握って続行)
      await page.waitForLoadState("networkidle", { timeout: timeoutMs }).catch(() => {});
      // 注意: evaluate 内に名前付き関数を置くと tsx/esbuild の keepNames が __name を注入し
      // ブラウザ側で ReferenceError になる。インラインのみで本文らしい要素→body の順に拾う。
      const text = await page.evaluate(() => {
        const el =
          document.querySelector("article") ||
          document.querySelector("main") ||
          document.querySelector('[role="main"]');
        const raw = (el && (el as HTMLElement).innerText) || document.body.innerText || "";
        return raw.replace(/\s+/g, " ").trim();
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
