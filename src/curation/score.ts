// 重要度スコアの算出と、同一リリース系列(rc等)の集約。
// スコア = 鮮度 + 注目度 + 内容 の重み付き和。prerelease/ファクト無しは減点係数で降格する。
// 重みや係数はすべて config.curation 由来(ハードコードしない)。
import type { AttentionMetrics, CurationConfig, SummarizedItem } from "../types.js";

/** x を log スケールで 0..1 に正規化(cap で 1 に到達)。 */
function lg(x: number | undefined, cap: number): number {
  if (!x || x <= 0) return 0;
  return Math.min(1, Math.log10(1 + x) / Math.log10(1 + cap));
}

/** 注目度シグナルを 0..1 に統合。記事個別シグナルを主、リポジトリstarは補助とする。 */
function attentionScore(a: AttentionMetrics | null | undefined): number {
  if (!a) return 0;
  const itemLevel = Math.max(
    lg(a.hfUpvotes, 100), // upvote 100 で最大
    lg(a.citationCount, 1000), // 引用 1000 で最大
    lg(a.ghReactions, 100), // reaction 100 で最大
  );
  const repoLevel = lg(a.ghStars, 100000); // star 10万で最大(補助)
  return Math.min(1, itemLevel * 0.8 + repoLevel * 0.2);
}

const NO_FACTS = /ファクト(は)?(一切)?(無|な)し|抽出すべき(技術的)?ファクトなし/;

/**
 * 「ファクト抽出なし」の要約か判定する(レポートで本文を出さず末尾リンクに回す用)。
 * 未要約(null/空)は false(別途プレースホルダ表示するため、ここには含めない)。
 */
export function isNoFacts(summary: string | null): boolean {
  return !!summary && summary.trim().length > 0 && NO_FACTS.test(summary);
}

/** 内容スコア: ファクト無し=0 / 破壊的変更あり=1 / それ以外で要約あり=0.5。 */
function contentScore(summary: string | null): number {
  if (!summary || !summary.trim()) return 0;
  if (NO_FACTS.test(summary)) return 0;
  if (/破壊的変更/.test(summary)) return 1;
  return 0.5;
}

/** publishedAt(無ければ now)からの経過日数で鮮度を指数減衰。 */
function recencyScore(publishedAt: string | null, now: number, halfLifeDays: number): number {
  if (!publishedAt) return 0.5; // 日付不明は中庸
  const ts = Date.parse(publishedAt);
  if (Number.isNaN(ts)) return 0.5;
  const ageDays = Math.max(0, (now - ts) / 86400000);
  return Math.pow(0.5, ageDays / Math.max(0.1, halfLifeDays));
}

/** スコア算出に必要な最小フィールド(SummarizedItem / StoredItem 双方が満たす)。 */
export type Scorable = {
  publishedAt: string | null;
  attention?: AttentionMetrics | null;
  summary: string | null;
};

/** 1記事の重要度スコア(0..1目安)。 */
export function scoreItem(item: Scorable, cfg: CurationConfig, now = Date.now()): number {
  const w = cfg.weights;
  const rec = recencyScore(item.publishedAt, now, cfg.recencyHalfLifeDays);
  const att = attentionScore(item.attention);
  const con = contentScore(item.summary);
  let score = w.recency * rec + w.attention * att + w.content * con;
  // prerelease(RC等)やファクト無し記事は降格
  if (item.attention?.prerelease || con === 0) score *= cfg.demoteFactor;
  return score;
}

/** 全記事にスコアを付与する(破壊的: item.score を書き換える)。 */
export function applyScores(items: SummarizedItem[], cfg: CurationConfig, now = Date.now()): void {
  for (const it of items) it.score = scoreItem(it, cfg, now);
}

/** バージョンタグから pre-release 接尾辞を除いた基準バージョン(系列キー)を作る。 */
function seriesBase(title: string): string | null {
  const m = title.match(/v?\d+\.\d+(\.\d+)?/);
  if (!m) return null;
  return m[0].replace(/(rc|alpha|beta|-pre).*$/i, "");
}

export interface SeriesGroup {
  /** 代表記事(系列内で最高スコア)。 */
  primary: SummarizedItem;
  /** 同系列の残り(rc等)。スコア降順。 */
  others: SummarizedItem[];
}

/**
 * 同一リリース系列(同じ基準バージョン)を1グループに集約する。
 * 系列が組めない記事は others 空の単独グループになる。グループは primary スコア降順で返す。
 */
export function groupBySeries(items: SummarizedItem[], enabled: boolean): SeriesGroup[] {
  if (!enabled) {
    return [...items]
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .map((primary) => ({ primary, others: [] }));
  }
  const groups = new Map<string, SummarizedItem[]>();
  for (const it of items) {
    const base = seriesBase(it.title);
    // 系列キーは「基準バージョンがある時だけ」共有。無ければ itemKey で単独化。
    const key = base ? `series:${base}` : `solo:${it.sourceId}:${it.itemKey}`;
    const arr = groups.get(key) ?? [];
    arr.push(it);
    groups.set(key, arr);
  }
  const out: SeriesGroup[] = [];
  for (const arr of groups.values()) {
    arr.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    const primary = arr[0];
    if (!primary) continue;
    out.push({ primary, others: arr.slice(1) });
  }
  out.sort((a, b) => (b.primary.score ?? 0) - (a.primary.score ?? 0));
  return out;
}

/** 注目度を人間向けの短い表記にする(例 "👍HF 42 · ⭐1.2k · 引用 8")。無ければ空。 */
export function attentionBadge(a: AttentionMetrics | null | undefined): string {
  if (!a) return "";
  const parts: string[] = [];
  if (a.hfUpvotes != null) parts.push(`👍HF ${a.hfUpvotes}`);
  if (a.citationCount != null) parts.push(`引用 ${a.citationCount}`);
  if (a.ghReactions != null) parts.push(`💬 ${a.ghReactions}`);
  if (a.ghStars != null) parts.push(`⭐${fmtK(a.ghStars)}`);
  if (a.prerelease) parts.push("⚠prerelease");
  return parts.join(" · ");
}

function fmtK(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}
