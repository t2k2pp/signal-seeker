import Parser from "rss-parser";
import type { Item, Source } from "../types.js";
import { hashContent } from "../db.js";

// Atom の <summary>(arXiv API の要旨など)を拾えるよう customField を追加。
type ExtraFields = { summary?: string };
const parser = new Parser<unknown, ExtraFields>({
  timeout: 20000,
  customFields: { item: ["summary"] },
});

/** github_release 型は repo URL を releases.atom に正規化する。 */
function resolveFeedUrl(source: Source): string {
  if (source.type === "github_release") {
    if (source.url.endsWith(".atom")) return source.url;
    return `${source.url.replace(/\/+$/, "")}/releases.atom`;
  }
  return source.url;
}

/** RSS/Atom フィードから Item[] を取得する。ブラウザ不要。 */
export async function collectRss(source: Source, limit: number, maxContentChars: number): Promise<Item[]> {
  const feedUrl = resolveFeedUrl(source);
  const feed = await parser.parseURL(feedUrl);
  const items: Item[] = [];

  for (const entry of (feed.items ?? []).slice(0, limit)) {
    const title = (entry.title ?? "(無題)").trim();
    const url = entry.link ?? feedUrl;
    // 本文候補: content(全文) → summary(Atom要旨) → contentSnippet(整形済)。タグ除去後に上限で切る。
    const rawBody = entry.content ?? entry.summary ?? entry.contentSnippet ?? "";
    const body = rawBody
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, maxContentChars);
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
