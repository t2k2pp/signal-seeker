import type { CurationConfig, RunResult, SummarizedItem } from "../types.js";
import { attentionBadge, type SeriesGroup } from "../curation/score.js";
import { anchor, buildReportModel, type ReportModel } from "./model.js";

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

/** 構造化モデルから Markdown を描画する。 */
export function renderMarkdown(model: ReportModel): string {
  const runTag = model.runId != null ? ` (run #${model.runId})` : "";
  const lines: string[] = [`# SignalSeeker レポート ${model.date}${runTag}`, ""];

  if (model.total === 0) {
    lines.push("今回の新規・更新はありませんでした。", "");
    return lines.join("\n");
  }

  lines.push(`新規・更新: **${model.total}件**`, "");
  if (model.rankByScore) lines.push("_重要度スコア(★)降順・「現地での注目度」併記_", "");

  // カテゴリ別件数の俯瞰(Mermaid 円グラフ。GitHub/Obsidian/VSCode 等でレンダリングされる)
  if (model.catBlocks.length > 0) {
    lines.push("```mermaid", "pie showData title カテゴリ別 件数");
    for (const cb of model.catBlocks) {
      lines.push(`    "${cb.category.replace(/"/g, "'")}" : ${cb.count}`);
    }
    lines.push("```", "");
  }

  // 目次(カテゴリ→ソース、記事数付き。表示順は本文と一致)
  lines.push("## 目次", "");
  for (const cb of model.catBlocks) {
    lines.push(`- [${cb.category}](#${anchor(cb.category)}) (${cb.count}件)`);
    for (const sb of cb.sources) {
      lines.push(`  - [${sb.sourceName}](#${anchor(sb.sourceName)}) (${sb.count}件)`);
    }
  }
  lines.push("", "---", "");

  for (const cb of model.catBlocks) {
    lines.push(`## ${cb.category}`, "");
    for (const sb of cb.sources) {
      lines.push(`### ${sb.sourceName}`, "");
      for (const g of sb.groups) {
        renderPrimary(g.primary, lines);
        renderOthers(g.others, lines);
      }
    }
  }

  // 収集エラーはレポートに載せない(運用ログの領分)。errors は logger/JSONL とDBの runs.error に残る。
  return lines.join("\n");
}

/**
 * RunResult から Markdown レポートを生成する(従来の入口)。
 * 構造化は buildReportModel に委譲し、ここは描画のみ。HTML版と内容が一致する。
 */
export function buildMarkdown(result: RunResult, curation: CurationConfig, runId: number | null = null): string {
  return renderMarkdown(buildReportModel(result, curation, runId));
}

export type { SeriesGroup };
