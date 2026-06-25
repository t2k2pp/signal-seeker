// レポートの素データを実行ごとに JSON で残す。これが「配布」と「インフォグラフィック描画」の
// 契約になり、収集・要約を再実行せずに同一内容を後からHTML等へ再描画できる。
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CurationConfig, ReportPeriod, RunResult, SummarizedItem } from "../types.js";
import { buildReportModel, type ReportKind, type ReportModel } from "./model.js";

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
  /** daily=日次 / weekly=期間振り返り(無い旧スナップショットは daily 扱い)。 */
  kind?: ReportKind;
  /** weekly のときの対象期間。 */
  period?: ReportPeriod | null;
}

/** writeSnapshot の追加情報(週次レポート用)。 */
export interface SnapshotExtra {
  kind?: ReportKind;
  period?: ReportPeriod | null;
}

function snapshotPath(reportsDir: string, runLabel: string): string {
  return join(reportsDir, `report-${runLabel}.json`);
}

/** RunResult からスナップショットを reportsDir に書き出し、保存パスを返す。 */
export function writeSnapshot(
  result: RunResult,
  runLabel: string,
  reportsDir: string,
  extra: SnapshotExtra = {},
): string {
  mkdirSync(reportsDir, { recursive: true });
  const counts = { new: 0, updated: 0, carried: 0 };
  for (const it of result.summarized) counts[it.state]++;
  const snapshot: ReportSnapshot = {
    runId: result.runId,
    runLabel,
    generatedAt: new Date().toISOString(),
    date: extra.period?.end ?? new Date().toISOString().slice(0, 10),
    counts,
    summarized: result.summarized,
    kind: extra.kind ?? "daily",
    period: extra.period ?? null,
  };
  const path = snapshotPath(reportsDir, runLabel);
  writeFileSync(path, JSON.stringify(snapshot), "utf-8");
  return path;
}

export function readSnapshot(path: string): ReportSnapshot {
  return JSON.parse(readFileSync(path, "utf-8")) as ReportSnapshot;
}

/**
 * スナップショットから RunResult を再構成し、Markdown/HTML と同一の ReportModel を組む。
 * 収集・要約を再実行せずに後から再描画する共通入口(infographic CLI と Web API が共有)。
 */
export function modelFromSnapshot(
  snap: ReportSnapshot,
  curation: CurationConfig,
  channelName: string | null,
): ReportModel {
  const result: RunResult = {
    runId: snap.runId,
    startedAt: snap.generatedAt,
    finishedAt: snap.generatedAt,
    summarized: snap.summarized,
    errors: [],
  };
  return buildReportModel(result, curation, {
    runId: snap.runId,
    date: snap.date,
    kind: snap.kind ?? "daily",
    period: snap.period ?? null,
    channelName,
  });
}

/** reportsDir 配下の全スナップショットを generatedAt 降順(新しい順)で返す。 */
export function listSnapshots(reportsDir: string): ReportSnapshot[] {
  let names: string[];
  try {
    names = readdirSync(reportsDir);
  } catch {
    return [];
  }
  const snaps: ReportSnapshot[] = [];
  for (const name of names) {
    if (!name.startsWith("report-") || !name.endsWith(".json")) continue;
    try {
      snaps.push(readSnapshot(join(reportsDir, name)));
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
 * reportsDir 内から条件に合うスナップショットを1件解決する。見つからなければ理由を Error で投げる。
 * 優先順位: runId 指定 > label 指定 > latest(既定)。
 */
export function resolveSnapshot(reportsDir: string, sel: SnapshotSelector): ReportSnapshot {
  const all = listSnapshots(reportsDir);
  if (all.length === 0) {
    throw new Error(
      `スナップショットがありません(${reportsDir})。先に npm run crawl を実行してください。`,
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
