import Parser from "rss-parser";
import type { Item, Source } from "../types.js";
import { hashContent } from "../db.js";

const parser = new Parser({ timeout: 20000 });

/** github_release 型は repo URL を releases.atom に正規化する。 */
function resolveFeedUrl(source: Source): string {
  if (source.type === "github_release") {
    if (source.url.endsWith(".atom")) return source.url;
    return `${source.url.replace(/\/+$/, "")}/releases.atom`;
  }
  return source.url;
}

/** RSS/Atom フィードから Item[] を取得する。ブラウザ不要。 */
export async function collectRss(source: Source, limit: number): Promise<Item[]> {
  const feedUrl = resolveFeedUrl(source);
  const feed = await parser.parseURL(feedUrl);
  const items: Item[] = [];

  for (const entry of (feed.items ?? []).slice(0, limit)) {
    const title = (entry.title ?? "(無題)").trim();
    const url = entry.link ?? feedUrl;
    const body = (entry.contentSnippet ?? entry.content ?? "").trim();
    const itemKey = entry.link ?? title.toLowerCase();
    items.push({
      sourceId: source.id,
      itemKey,
      title,
      url,
      publishedAt: entry.isoDate ?? entry.pubDate ?? null,
      contentHash: hashContent(title, body),
      rawText: body,
    });
  }
  return items;
}
