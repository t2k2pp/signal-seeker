// レポートの素データを実行ごとに JSON で残す。これが「配布」と「インフォグラフィック描画」の
// 契約になり、収集・要約を再実行せずに同一内容を後からHTML等へ再描画できる。
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PROJECT_ROOT } from "../config.js";
import type { RunResult, SummarizedItem } from "../types.js";

const REPORTS_DIR = join(PROJECT_ROOT, "data", "reports");

/** 1回のレポートの素データ。SummarizedItem をそのまま保持する(再描画に必要十分)。 */
export interface ReportSnapshot {
  runId: number | null;
  /** ファイル名に使う実行ラベル(report-<runLabel>.md/.json/.html で揃える)。 */
  runLabel: string;
  /** 生成時刻(ISO)。最新判定に使う。 */
  generatedAt: string;
  date: string;
  counts: { new: number; updated: number; carried: number };
  summarized: SummarizedItem[];
}

function snapshotPath(runLabel: string): string {
  return join(REPORTS_DIR, `report-${runLabel}.json`);
}

/** RunResult からスナップショットを書き出し、保存パスを返す。 */
export function writeSnapshot(result: RunResult, runLabel: string): string {
  mkdirSync(REPORTS_DIR, { recursive: true });
  const counts = { new: 0, updated: 0, carried: 0 };
  for (const it of result.summarized) counts[it.state]++;
  const snapshot: ReportSnapshot = {
    runId: result.runId,
    runLabel,
    generatedAt: new Date().toISOString(),
    date: new Date().toISOString().slice(0, 10),
    counts,
    summarized: result.summarized,
  };
  const path = snapshotPath(runLabel);
  writeFileSync(path, JSON.stringify(snapshot), "utf-8");
  return path;
}

export function readSnapshot(path: string): ReportSnapshot {
  return JSON.parse(readFileSync(path, "utf-8")) as ReportSnapshot;
}

/** data/reports 配下の全スナップショットを generatedAt 降順(新しい順)で返す。 */
function listSnapshots(): ReportSnapshot[] {
  let names: string[];
  try {
    names = readdirSync(REPORTS_DIR);
  } catch {
    return [];
  }
  const snaps: ReportSnapshot[] = [];
  for (const name of names) {
    if (!name.startsWith("report-") || !name.endsWith(".json")) continue;
    try {
      snaps.push(readSnapshot(join(REPORTS_DIR, name)));
    } catch {
      // 壊れたスナップショットは無視(本処理を止めない)
    }
  }
  snaps.sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
  return snaps;
}

export interface SnapshotSelector {
  runId?: number;
  label?: string;
  latest?: boolean;
}

/**
 * 指定条件でスナップショットを1件解決する。見つからなければ理由を Error で投げる(握りつぶさない)。
 * 優先順位: runId 指定 > label 指定 > latest(既定)。
 */
export function resolveSnapshot(sel: SnapshotSelector): ReportSnapshot {
  const all = listSnapshots();
  if (all.length === 0) {
    throw new Error(
      `スナップショットがありません(${REPORTS_DIR})。先に npm run crawl を実行してください。`,
    );
  }
  if (sel.runId != null) {
    const hit = all.find((s) => s.runId === sel.runId);
    if (!hit) throw new Error(`run #${sel.runId} のスナップショットが見つかりません。`);
    return hit;
  }
  if (sel.label) {
    const hit = all.find((s) => s.runLabel === sel.label);
    if (!hit) throw new Error(`label "${sel.label}" のスナップショットが見つかりません。`);
    return hit;
  }
  return all[0]!; // 新しい順。listSnapshots が空でないことは確認済み。
}
