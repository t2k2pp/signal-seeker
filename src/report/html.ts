// ダーク・ダッシュボード固定テーマの HTML インフォグラフィック。
// Markdown と同じ ReportModel から描くため内容は必ず一致する。
// 外部CSS/JS/フォント/画像に依存しない完全自己完結HTML(単体で開ける・持ち運べる)。
import type { AttentionMetrics, SummarizedItem } from "../types.js";
import { anchor, type NoFactLink, type ReportModel, type SourceBlock } from "./model.js";

/** 固定テーマ。実行ごとに変えない(配色は1か所に集約)。 */
const THEME = {
  bg: "#0b1220",
  panel: "#131c2e",
  card: "#1a2740",
  cardBorder: "#243049",
  text: "#e2e8f0",
  muted: "#94a3b8",
  accent: "#22d3ee", // シアン
  accentSoft: "#0e7490",
  score: "#fbbf24",
  stateNew: "#22c55e",
  stateUpdated: "#f59e0b",
  stateCarried: "#64748b",
};

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stateInfo(item: SummarizedItem): { label: string; color: string } {
  if (item.state === "new") return { label: "🆕 新規", color: THEME.stateNew };
  if (item.state === "updated") return { label: "♻️ 更新", color: THEME.stateUpdated };
  return { label: "📥 繰越", color: THEME.stateCarried };
}

function fmtK(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

/** 注目度を色付きチップの配列にする(attentionBadge と同じ素データから)。 */
function attentionChips(a: AttentionMetrics | null | undefined): string {
  if (!a) return "";
  const chips: { text: string; color: string }[] = [];
  if (a.hfUpvotes != null) chips.push({ text: `👍HF ${a.hfUpvotes}`, color: "#a78bfa" });
  if (a.citationCount != null) chips.push({ text: `引用 ${a.citationCount}`, color: "#38bdf8" });
  if (a.ghReactions != null) chips.push({ text: `💬 ${a.ghReactions}`, color: "#f472b6" });
  if (a.ghStars != null) chips.push({ text: `⭐${fmtK(a.ghStars)}`, color: THEME.score });
  if (a.prerelease) chips.push({ text: "⚠prerelease", color: "#f87171" });
  return chips
    .map(
      (c) =>
        `<span class="chip" style="border-color:${c.color};color:${c.color}">${esc(c.text)}</span>`,
    )
    .join("");
}

/** 要約の箇条書き("- "始まり)を <ul> に、それ以外を <p> に変換する。 */
function renderSummary(summary: string | null): string {
  if (!summary || !summary.trim()) {
    return `<p class="empty">要約を取得できませんでした(次回実行で再要約します)。</p>`;
  }
  const lines = summary.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out: string[] = [];
  let inList = false;
  for (const line of lines) {
    const m = line.match(/^[-*]\s+(.*)$/);
    if (m) {
      if (!inList) {
        out.push("<ul>");
        inList = true;
      }
      out.push(`<li>${esc(m[1] ?? "")}</li>`);
    } else {
      if (inList) {
        out.push("</ul>");
        inList = false;
      }
      out.push(`<p>${esc(line)}</p>`);
    }
  }
  if (inList) out.push("</ul>");
  return out.join("");
}

function renderArticle(item: SummarizedItem, showState: boolean): string {
  const st = stateInfo(item);
  const meta: string[] = [];
  if (item.score != null) meta.push(`<span class="score">★${item.score.toFixed(2)}</span>`);
  const chips = attentionChips(item.attention);
  if (chips) meta.push(chips);
  if (item.publishedAt) meta.push(`<span class="date">${esc(item.publishedAt)}</span>`);
  return `
    <article class="article">
      <div class="art-head">
        ${showState ? `<span class="state" style="background:${st.color}">${st.label}</span>` : ""}
        <a class="title" href="${esc(item.url)}" target="_blank" rel="noopener">${esc(item.title)}</a>
      </div>
      ${meta.length ? `<div class="meta">${meta.join("")}</div>` : ""}
      <div class="summary">${renderSummary(item.summary)}</div>
    </article>`;
}

/** ファクト抽出なし記事をソースカード末尾に折りたたみでリンク列挙する。 */
function renderNoFactsHtml(noFacts: NoFactLink[]): string {
  if (noFacts.length === 0) return "";
  const items = noFacts
    .map(
      (n) =>
        `<li><a href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.title)}</a>${
          n.publishedAt ? ` <span class="date">${esc(n.publishedAt)}</span>` : ""
        }</li>`,
    )
    .join("");
  return `<details class="others"><summary>参考(ファクト抽出なし) ${noFacts.length}件</summary><ul>${items}</ul></details>`;
}

function renderSourceCard(sb: SourceBlock, showState: boolean): string {
  const groups = sb.groups
    .map((g) => {
      const primary = renderArticle(g.primary, showState);
      if (g.others.length === 0) return primary;
      const others = g.others
        .map(
          (o) =>
            `<li><a href="${esc(o.url)}" target="_blank" rel="noopener">${esc(o.title)}</a>${
              o.publishedAt ? ` <span class="date">${esc(o.publishedAt)}</span>` : ""
            }</li>`,
        )
        .join("");
      return `${primary}<details class="others"><summary>同系列の関連 ${g.others.length}件</summary><ul>${others}</ul></details>`;
    })
    .join("");
  return `
    <div class="card">
      <div class="card-head"><span class="src-name">${esc(sb.sourceName)}</span><span class="src-count">${sb.count}</span></div>
      ${groups}
      ${renderNoFactsHtml(sb.noFacts)}
    </div>`;
}

/** 構造化モデルから HTML インフォグラフィックを描画する。 */
export function renderHtml(model: ReportModel): string {
  const weekly = model.kind === "weekly";
  const runTag = model.runId != null ? `run #${model.runId}` : "run —";
  const ch = model.channelName ? `[${model.channelName}] ` : "";
  // タイトル(週次は期間、日次は日付+run)とサブタイトル・件数表記を kind で切替。
  const titleText = weekly
    ? `${ch}週次レポート ${model.period?.start ?? ""} 〜 ${model.period?.end ?? ""}`
    : `${ch}レポート ${model.date} (${runTag})`;
  const brandText = weekly ? `SignalSeeker ${ch}週次レポート` : `SignalSeeker ${ch}レポート`;
  const subText = weekly
    ? `${model.period?.start ?? ""} 〜 ${model.period?.end ?? ""} ・ ${model.period?.days ?? ""}日間 ・ 収集日ベース`
    : `${model.date} ・ ${runTag}`;
  const countsHtml = weekly
    ? `<span class="count" style="color:${THEME.accent}"><b>${model.total}</b>件（対象期間）</span>`
    : `<span class="count" style="color:${THEME.stateNew}"><b>${model.counts.new}</b>新規</span>
      <span class="count" style="color:${THEME.stateUpdated}"><b>${model.counts.updated}</b>更新</span>
      <span class="count" style="color:${THEME.stateCarried}"><b>${model.counts.carried}</b>繰越</span>`;
  const footTag = weekly ? `${model.period?.start ?? ""} 〜 ${model.period?.end ?? ""}` : runTag;
  const head = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>SignalSeeker ${esc(titleText)}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; background:${THEME.bg}; color:${THEME.text};
    font-family: "Segoe UI", "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif; line-height:1.7; }
  .wrap { max-width: 1080px; margin: 0 auto; padding: 24px 20px 64px; }
  header { background: linear-gradient(135deg, ${THEME.panel}, ${THEME.card});
    border:1px solid ${THEME.cardBorder}; border-radius:14px; padding:20px 24px; margin-bottom:24px;
    box-shadow: 0 8px 24px rgba(0,0,0,.35); }
  .brand { display:flex; align-items:center; gap:10px; font-size:20px; font-weight:700; }
  .brand .dot { width:12px; height:12px; border-radius:50%; background:${THEME.accent};
    box-shadow:0 0 10px ${THEME.accent}; }
  .sub { color:${THEME.muted}; font-size:13px; margin-top:4px; }
  .counts { display:flex; gap:10px; margin-top:14px; flex-wrap:wrap; }
  .count { border:1px solid ${THEME.cardBorder}; border-radius:999px; padding:4px 12px; font-size:13px; }
  .count b { font-size:16px; margin-right:4px; }
  .toc { display:flex; gap:8px; flex-wrap:wrap; margin: 0 0 28px; }
  .toc a { text-decoration:none; color:${THEME.accent}; border:1px solid ${THEME.accentSoft};
    border-radius:999px; padding:4px 12px; font-size:13px; }
  .toc a span { color:${THEME.muted}; }
  section.cat { margin-bottom:34px; }
  h2 { font-size:18px; border-left:4px solid ${THEME.accent}; padding-left:10px; margin:0 0 14px; }
  h2 .cat-count { color:${THEME.muted}; font-size:13px; font-weight:400; margin-left:8px; }
  .cards { display:grid; grid-template-columns: 1fr; gap:16px; }
  @media (min-width: 720px) { .cards { grid-template-columns: 1fr 1fr; } }
  .card { background:${THEME.card}; border:1px solid ${THEME.cardBorder}; border-radius:12px;
    padding:14px 16px; box-shadow:0 4px 14px rgba(0,0,0,.3); }
  .card-head { display:flex; align-items:baseline; justify-content:space-between;
    border-bottom:1px solid ${THEME.cardBorder}; padding-bottom:8px; margin-bottom:10px; }
  .src-name { font-weight:700; color:${THEME.accent}; }
  .src-count { color:${THEME.muted}; font-size:12px; }
  .article { padding:8px 0; border-top:1px dashed ${THEME.cardBorder}; }
  .article:first-of-type { border-top:none; }
  .art-head { display:flex; align-items:flex-start; gap:8px; }
  .state { flex:none; font-size:11px; padding:1px 8px; border-radius:999px; color:#0b1220; font-weight:700; }
  .title { color:${THEME.text}; text-decoration:none; font-weight:600; }
  .title:hover { color:${THEME.accent}; text-decoration:underline; }
  .meta { display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin:6px 0; font-size:12px; }
  .score { color:${THEME.score}; font-weight:700; }
  .date { color:${THEME.muted}; }
  .chip { border:1px solid; border-radius:999px; padding:1px 8px; font-size:11px; }
  .summary { font-size:14px; color:#cbd5e1; }
  .summary ul { margin:6px 0; padding-left:20px; }
  .summary li { margin:2px 0; }
  .summary p { margin:4px 0; }
  .summary .empty { color:${THEME.muted}; font-style:italic; }
  details.others { margin:6px 0 2px; }
  details.others summary { cursor:pointer; color:${THEME.muted}; font-size:12px; }
  details.others ul { margin:6px 0; padding-left:18px; font-size:13px; }
  details.others a { color:${THEME.accent}; text-decoration:none; }
  .empty-report { color:${THEME.muted}; text-align:center; padding:48px 0; }
  footer { color:${THEME.muted}; font-size:12px; text-align:center; margin-top:40px; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <div class="brand"><span class="dot"></span>${brandText}</div>
    <div class="sub">${esc(subText)}</div>
    <div class="counts">
      ${countsHtml}
    </div>
  </header>`;

  const foot = `
  <footer>SignalSeeker — 一次情報キュレーション ・ ${esc(footTag)}</footer>
</div>
</body>
</html>`;

  if (model.total === 0) {
    const msg = weekly ? "対象期間に該当する記事はありませんでした。" : "今回の新規・更新はありませんでした。";
    return `${head}\n<p class="empty-report">${msg}</p>${foot}`;
  }

  const toc = `<nav class="toc">${model.catBlocks
    .map((cb) => `<a href="#${anchor(cb.category)}">${esc(cb.category)} <span>${cb.count}</span></a>`)
    .join("")}</nav>`;

  const body = model.catBlocks
    .map(
      (cb) => `
  <section class="cat" id="${anchor(cb.category)}">
    <h2>${esc(cb.category)}<span class="cat-count">${cb.count}件</span></h2>
    <div class="cards">${cb.sources.map((sb) => renderSourceCard(sb, !weekly)).join("")}</div>
  </section>`,
    )
    .join("");

  return `${head}\n${toc}\n${body}${foot}`;
}
