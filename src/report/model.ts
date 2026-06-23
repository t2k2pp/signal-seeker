// レポートの「構造化モデル」。Markdown と HTML はこの同一モデルから描画するため、
// 並び順・件数・グルーピングが両者で必ず一致する。スコア付与・カテゴリ/ソース集約・
// 系列集約・並べ替え・目次素材の組み立てをここに集約する(描画はしない)。
import type { CurationConfig, RunResult, SummarizedItem } from "../types.js";
import { applyScores, groupBySeries, type SeriesGroup } from "../curation/score.js";

/** 1ソース分のブロック(系列集約済み)。 */
export interface SourceBlock {
  sourceName: string;
  /** このソースの総記事数(代表+同系列の関連)。 */
  count: number;
  groups: SeriesGroup[];
}

/** 1カテゴリ分のブロック。 */
export interface CatBlock {
  category: string;
  /** このカテゴリの総記事数。 */
  count: number;
  sources: SourceBlock[];
}

/** レポート1回分の構造化モデル(描画の入力)。 */
export interface ReportModel {
  date: string;
  /** 実行ID(run-id)。確認・再描画の手がかり。 */
  runId: number | null;
  /** 新規・更新・繰越の合計件数。 */
  total: number;
  counts: { new: number; updated: number; carried: number };
  rankByScore: boolean;
  catBlocks: CatBlock[];
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** グループ配列の総記事数(代表+同系列の関連)。 */
function blockCount(groups: SeriesGroup[]): number {
  return groups.reduce((a, g) => a + 1 + g.others.length, 0);
}

const groupTop = (g: SeriesGroup[]) => g[0]?.primary.score ?? 0;

/** GitHub互換の見出しアンカーを作る(目次リンク用)。記号除去・小文字・空白を-に。 */
export function anchor(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");
}

/**
 * RunResult から構造化モデルを組み立てる。
 * curation 設定に従いスコアを付与し、カテゴリ→ソースで集約、同一リリース系列を集約、
 * rankByScore ならスコア降順に並べ替える。
 */
export function buildReportModel(
  result: RunResult,
  curation: CurationConfig,
  runId: number | null = null,
): ReportModel {
  const counts = { new: 0, updated: 0, carried: 0 };
  for (const it of result.summarized) counts[it.state]++;

  const model: ReportModel = {
    date: today(),
    runId,
    total: result.summarized.length,
    counts,
    rankByScore: curation.rankByScore,
    catBlocks: [],
  };
  if (result.summarized.length === 0) return model;

  applyScores(result.summarized, curation);

  // カテゴリ → ソース でグルーピング
  const byCategory = new Map<string, Map<string, SummarizedItem[]>>();
  for (const item of result.summarized) {
    const cat = byCategory.get(item.category) ?? new Map<string, SummarizedItem[]>();
    const arr = cat.get(item.sourceName) ?? [];
    arr.push(item);
    cat.set(item.sourceName, arr);
    byCategory.set(item.category, cat);
  }

  // ソースごとに系列集約 → ブロック化。並べ替えは rankByScore に従う。
  for (const [category, sources] of byCategory) {
    const srcBlocks: SourceBlock[] = [];
    for (const [sourceName, items] of sources) {
      const groups = groupBySeries(items, curation.groupReleaseSeries);
      srcBlocks.push({ sourceName, count: blockCount(groups), groups });
    }
    if (curation.rankByScore) srcBlocks.sort((a, b) => groupTop(b.groups) - groupTop(a.groups));
    const count = srcBlocks.reduce((a, s) => a + s.count, 0);
    model.catBlocks.push({ category, count, sources: srcBlocks });
  }
  if (curation.rankByScore) {
    model.catBlocks.sort(
      (a, b) =>
        Math.max(...b.sources.map((s) => groupTop(s.groups)), 0) -
        Math.max(...a.sources.map((s) => groupTop(s.groups)), 0),
    );
  }
  return model;
}
