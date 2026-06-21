import type { RunResult, SummarizedItem } from "../types.js";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** カテゴリ→ソース→記事 の階層で日次Markdownレポートを生成する。 */
export function buildMarkdown(result: RunResult): string {
  const date = today();
  const lines: string[] = [`# SignalSeeker レポート ${date}`, ""];

  if (result.summarized.length === 0) {
    lines.push("今回の新規・更新はありませんでした。", "");
  } else {
    lines.push(`新規・更新: **${result.summarized.length}件**`, "");

    // カテゴリ → ソース でグルーピング
    const byCategory = new Map<string, Map<string, SummarizedItem[]>>();
    for (const item of result.summarized) {
      const cat = byCategory.get(item.category) ?? new Map<string, SummarizedItem[]>();
      const arr = cat.get(item.sourceName) ?? [];
      arr.push(item);
      cat.set(item.sourceName, arr);
      byCategory.set(item.category, cat);
    }

    for (const [category, sources] of byCategory) {
      lines.push(`## ${category}`, "");
      for (const [sourceName, items] of sources) {
        lines.push(`### ${sourceName}`, "");
        for (const item of items) {
          const badge = item.state === "new" ? "🆕" : item.state === "updated" ? "♻️更新" : "📥繰越";
          lines.push(`#### ${badge} [${item.title}](${item.url})`);
          if (item.publishedAt) lines.push(`*${item.publishedAt}*`);
          lines.push("");
          lines.push(item.summary?.trim() || "_要約を取得できませんでした。_");
          lines.push("");
        }
      }
    }
  }

  if (result.errors.length > 0) {
    lines.push("---", "", "## 収集エラー", "");
    for (const e of result.errors) lines.push(`- \`${e.sourceId}\`: ${e.message}`);
    lines.push("");
  }

  return lines.join("\n");
}
