// サイトURLから RSS/Atom フィードURLを自動発見する。
// 特定サイト向けの個別ロジックは持たず、(1)HTMLの<link rel=alternate>解析、
// (2)よくあるフィードパスの総当たり検証、の汎用2手段だけで解決する。
import type { Logger } from "../logger.js";

const UA = { "User-Agent": "Mozilla/5.0 (compatible; SignalSeeker/1.0)" };

/** HTML から <link rel="alternate" type="application/(rss|atom)+xml"> の href を取り出す。 */
function extractFeedLinks(html: string, base: string): string[] {
  const out: string[] = [];
  const re = /<link\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const tag = m[0];
    if (!/rel=["']?alternate/i.test(tag)) continue;
    if (!/(rss|atom)\+xml/i.test(tag)) continue;
    const href = tag.match(/href=["']([^"']+)["']/i);
    if (href && href[1]) {
      try {
        out.push(new URL(href[1], base).href);
      } catch {
        /* 不正URLは無視 */
      }
    }
  }
  return out;
}

/** 本文がフィード(XML)らしいか軽く判定する。 */
function looksLikeFeed(contentType: string | null, body: string): boolean {
  if (contentType && /(xml|rss|atom)/i.test(contentType)) return true;
  const head = body.slice(0, 500).trimStart().toLowerCase();
  return head.startsWith("<?xml") || head.includes("<rss") || head.includes("<feed") || head.includes("<rdf");
}

/** よくあるフィードパスの候補を URL から機械的に生成する(サイト固有知識なし)。 */
function candidatePaths(siteUrl: string): string[] {
  const u = new URL(siteUrl);
  const origin = u.origin;
  const base = `${origin}${u.pathname.replace(/\/+$/, "")}`;
  const suffixes = ["/rss.xml", "/rss", "/rss/", "/feed", "/feed/", "/feed.xml", "/atom.xml", "/index.xml"];
  const set = new Set<string>();
  for (const s of suffixes) set.add(base + s);
  for (const s of suffixes) set.add(origin + s);
  return [...set];
}

async function tryFetch(url: string, timeoutMs: number): Promise<{ status: number; contentType: string | null; body: string } | null> {
  try {
    const res = await fetch(url, { headers: UA, redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
    const body = await res.text();
    return { status: res.status, contentType: res.headers.get("content-type"), body };
  } catch {
    return null;
  }
}

/**
 * サイトURLからフィードURLを発見する。見つからなければ null。
 * 手段: ①トップHTMLの<link rel=alternate> ②共通フィードパスの総当たり検証。
 */
export async function discoverFeed(siteUrl: string, timeoutMs: number, logger?: Logger): Promise<string | null> {
  // ① トップページの <link> を解析
  const top = await tryFetch(siteUrl, timeoutMs);
  if (top && top.status === 200) {
    const links = extractFeedLinks(top.body, siteUrl);
    for (const link of links) {
      const f = await tryFetch(link, timeoutMs);
      if (f && f.status === 200 && looksLikeFeed(f.contentType, f.body)) {
        logger?.debug("feed_discovered", { siteUrl, feedUrl: link, via: "link-tag" });
        return link;
      }
    }
  }
  // ② 共通パス総当たり
  for (const cand of candidatePaths(siteUrl)) {
    const f = await tryFetch(cand, timeoutMs);
    if (f && f.status === 200 && looksLikeFeed(f.contentType, f.body)) {
      logger?.debug("feed_discovered", { siteUrl, feedUrl: cand, via: "common-path" });
      return cand;
    }
  }
  logger?.debug("feed_not_found", { siteUrl });
  return null;
}
