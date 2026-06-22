import type { CollectConfig, Item, RuntimeConfig, Source } from "../types.js";
import { collectRss } from "./rss.js";
import { BrowserSession } from "./playwright.js";
import { discoverFeed } from "./feed-discovery.js";
import { hashContent } from "../db.js";
import type { Logger } from "../logger.js";

export interface CollectResult {
  items: Item[];
  errors: { sourceId: string; message: string }[];
}

type Strategy = { kind: "rss"; feedUrl: string } | { kind: "html" };

/** URL がそのままフィードを指していそうか(拡張子や /feed・/rss、arXiv API 等)。 */
function looksLikeFeedUrl(url: string): boolean {
  return /(\.(xml|atom|rss)(\?|#|$))|\/feed\/?($|\?)|\/rss(\.xml)?\/?($|\?)|export\.arxiv\.org\/api/i.test(url);
}

/** GitHub の owner/repo トップURLか(releases.atom に正規化できる)。 */
function githubRepo(url: string): boolean {
  return /^https?:\/\/github\.com\/[^/]+\/[^/]+\/?$/.test(url);
}

/**
 * ソースの収集戦略を自動解決する。特定URLに特化させず、汎用の判定だけで決める。
 *  1. feedUrl 明示 → そのフィード
 *  2. github_release もしくは GitHub repo URL → releases.atom
 *  3. URL 自体がフィードらしい → そのまま RSS
 *  4. type=html 明示 → HTML 抽出(発見をスキップ)
 *  5. それ以外 → フィード自動発見 → 見つかれば RSS、無ければ HTML 抽出
 */
async function resolveStrategy(source: Source, runtime: RuntimeConfig, logger: Logger): Promise<Strategy> {
  if (source.feedUrl) return { kind: "rss", feedUrl: source.feedUrl };

  if (source.type === "github_release" || githubRepo(source.url)) {
    const base = source.url.replace(/\/+$/, "");
    return { kind: "rss", feedUrl: base.endsWith(".atom") ? base : `${base}/releases.atom` };
  }

  if (looksLikeFeedUrl(source.url)) return { kind: "rss", feedUrl: source.url };

  if (source.type === "html") return { kind: "html" };

  const feed = await discoverFeed(source.url, runtime.http.rssTimeoutMs, logger);
  return feed ? { kind: "rss", feedUrl: feed } : { kind: "html" };
}

/**
 * 全ソースを巡回し Item[] をまとめて返す。収集手段はソースごとに自動解決する
 * (フィード優先・無ければ汎用HTML抽出)。html 戦略がある場合のみブラウザを使う。
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

  // 同一ホストへの連続アクセスを最小間隔まで待つ(Reddit等のレート制限対策)。
  const lastHostAt = new Map<string, number>();
  const throttleHost = async (u: string): Promise<void> => {
    if (collect.perHostMinIntervalMs <= 0) return;
    let host: string;
    try {
      host = new URL(u).host;
    } catch {
      return;
    }
    const last = lastHostAt.get(host);
    if (last !== undefined) {
      const wait = collect.perHostMinIntervalMs - (Date.now() - last);
      if (wait > 0) {
        logger.debug("host_throttle", { host, waitMs: wait });
        await new Promise((r) => setTimeout(r, wait));
      }
    }
    lastHostAt.set(host, Date.now());
  };

  try {
    for (const source of sources) {
      try {
        const strategy = await resolveStrategy(source, runtime, logger);
        const limit = source.maxLinks ?? perSourceLimit;
        let collected: Item[];
        if (strategy.kind === "rss") {
          await throttleHost(strategy.feedUrl);
          collected = await collectRss(source, strategy.feedUrl, limit, collect.maxContentChars, runtime.http.rssTimeoutMs);
          // フィード本文が薄い記事は、記事ページ本文を汎用抽出で補完(サイト別セレクタ不要)
          if (collect.fetchArticleBody && collect.articleBodyMinChars > 0) {
            let backfilled = 0;
            for (const item of collected) {
              if (item.rawText.length >= collect.articleBodyMinChars) continue;
              if (!/^https?:\/\//.test(item.url)) continue;
              await throttleHost(item.url);
              const body = await browser.fetchArticle(item.url, collect.maxContentChars, runtime.playwright.articleTimeoutMs);
              if (body && body.length > item.rawText.length) {
                item.rawText = body;
                item.contentHash = hashContent(item.title, body);
                backfilled++;
              }
            }
            if (backfilled > 0) logger.info("article_backfilled", { sourceId: source.id, backfilled });
          }
        } else {
          await throttleHost(source.url);
          collected = await browser.collectHtml(source, {
            limit,
            maxContentChars: collect.maxContentChars,
            fetchArticleBody: collect.fetchArticleBody,
            navTimeoutMs: runtime.playwright.navTimeoutMs,
            articleTimeoutMs: runtime.playwright.articleTimeoutMs,
          });
        }
        items.push(...collected);
        logger.info("collect_source", {
          sourceId: source.id,
          strategy: strategy.kind,
          feedUrl: strategy.kind === "rss" ? strategy.feedUrl : undefined,
          count: collected.length,
        });
        if (collected.length === 0) {
          logger.warn("collect_source_empty", { sourceId: source.id, strategy: strategy.kind });
        }
      } catch (err) {
        const message = (err as Error).message;
        errors.push({ sourceId: source.id, message });
        logger.error("collect_source_failed", { sourceId: source.id, message });
      }
    }
  } finally {
    await browser.close();
  }

  return { items, errors };
}
