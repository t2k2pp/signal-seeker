import type { CurationConfig, RunResult, SummarizedItem } from "../types.js";
import { applyScores, groupBySeries, attentionBadge, type SeriesGroup } from "../curation/score.js";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function stateBadge(item: SummarizedItem): string {
  return item.state === "new" ? "🆕" : item.state === "updated" ? "♻️更新" : "📥繰越";
}

/** 1記事(系列の代表)を描画する。注目度バッジとスコアを見出し直下に併記。 */
function renderPrimary(item: SummarizedItem, lines: string[]): void {
  const badge = stateBadge(item);
  lines.push(`#### ${badge} [${item.title}](${item.url})`);
  const meta: string[] = [];
  if (item.score != null) meta.push(`★${item.score.toFixed(2)}`);
  const att = attentionBadge(item.attention);
  if (att) meta.push(att);
  if (item.publishedAt) meta.push(item.publishedAt);
  if (meta.length) lines.push(`*${meta.join("  ·  ")}*`);
  lines.push("");
  lines.push(item.summary?.trim() || "_要約を取得できませんでした(次回実行で再要約します)。_");
  lines.push("");
}

/** 同系列の残り(rc等)を折りたたみで列挙。 */
function renderOthers(others: SummarizedItem[], lines: string[]): void {
  if (others.length === 0) return;
  lines.push(`<details><summary>同系列の関連 ${others.length}件</summary>`, "");
  for (const o of others) {
    const att = attentionBadge(o.attention);
    lines.push(`- [${o.title}](${o.url})${att ? `  ·  ${att}` : ""}${o.publishedAt ? `  ·  ${o.publishedAt}` : ""}`);
  }
  lines.push("", "</details>", "");
}

const groupTop = (g: SeriesGroup[]) => g[0]?.primary.score ?? 0;

/** GitHub互換の見出しアンカーを作る(目次リンク用)。記号除去・小文字・空白を-に。 */
function anchor(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");
}

/** グループ配列の総記事数(代表+同系列の関連)。 */
const blockCount = (groups: SeriesGroup[]) => groups.reduce((a, g) => a + 1 + g.others.length, 0);

/**
 * カテゴリ→ソース→記事 の階層でMarkdownレポートを生成する。
 * curation 設定に従い、重要度スコアで並べ替え、同一リリース系列を集約し、注目度を併記する。
 */
export function buildMarkdown(result: RunResult, curation: CurationConfig): string {
  const date = today();
  const lines: string[] = [`# SignalSeeker レポート ${date}`, ""];

  if (result.summarized.length === 0) {
    lines.push("今回の新規・更新はありませんでした。", "");
  } else {
    applyScores(result.summarized, curation);
    lines.push(`新規・更新: **${result.summarized.length}件**`, "");
    if (curation.rankByScore) lines.push("_重要度スコア(★)降順・「現地での注目度」併記_", "");

    // カテゴリ → ソース でグルーピング
    const byCategory = new Map<string, Map<string, SummarizedItem[]>>();
    for (const item of result.summarized) {
      const cat = byCategory.get(item.category) ?? new Map<string, SummarizedItem[]>();
      const arr = cat.get(item.sourceName) ?? [];
      arr.push(item);
      cat.set(item.sourceName, arr);
      byCategory.set(item.category, cat);
    }

    // ソースごとに系列集約 → グループ配列に。並べ替えは rankByScore に従う。
    type SourceBlock = { sourceName: string; groups: SeriesGroup[] };
    type CatBlock = { category: string; sources: SourceBlock[] };
    const catBlocks: CatBlock[] = [];
    for (const [category, sources] of byCategory) {
      const srcBlocks: SourceBlock[] = [];
      for (const [sourceName, items] of sources) {
        srcBlocks.push({ sourceName, groups: groupBySeries(items, curation.groupReleaseSeries) });
      }
      if (curation.rankByScore) srcBlocks.sort((a, b) => groupTop(b.groups) - groupTop(a.groups));
      catBlocks.push({ category, sources: srcBlocks });
    }
    if (curation.rankByScore) {
      catBlocks.sort(
        (a, b) =>
          Math.max(...b.sources.map((s) => groupTop(s.groups)), 0) -
          Math.max(...a.sources.map((s) => groupTop(s.groups)), 0),
      );
    }

    // 目次(カテゴリ→ソース、記事数付き。表示順は本文と一致)
    lines.push("## 目次", "");
    for (const cb of catBlocks) {
      const catCount = cb.sources.reduce((a, s) => a + blockCount(s.groups), 0);
      lines.push(`- [${cb.category}](#${anchor(cb.category)}) (${catCount}件)`);
      for (const sb of cb.sources) {
        lines.push(`  - [${sb.sourceName}](#${anchor(sb.sourceName)}) (${blockCount(sb.groups)}件)`);
      }
    }
    lines.push("", "---", "");

    for (const cb of catBlocks) {
      lines.push(`## ${cb.category}`, "");
      for (const sb of cb.sources) {
        lines.push(`### ${sb.sourceName}`, "");
        for (const g of sb.groups) {
          renderPrimary(g.primary, lines);
          renderOthers(g.others, lines);
        }
      }
    }
  }

  // 収集エラーはレポートに載せない(運用ログの領分)。errors は logger/JSONL とDBの runs.error に残る。
  return lines.join("\n");
}
