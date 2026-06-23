// インフォグラフィック生成コマンド: 収集・要約をせず、保存済みスナップショットから
// レポートと同一内容の HTML(ダーク・ダッシュボード)を描画する。
//   npm run infographic -- [--run=<id> | --label=<label> | --latest] [--no-discord]
// 既定は --latest。生成した HTML は Discord にも添付送付する(config.notify.targets に
// discord があり、DISCORD_WEBHOOK_URL が設定されている場合。--no-discord で抑止)。
// run-id は `npm run db -- runs` やレポート見出しで確認できる。
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, PROJECT_ROOT } from "../config.js";
import type { RunResult } from "../types.js";
import { buildReportModel } from "./model.js";
import { renderHtml } from "./html.js";
import { resolveSnapshot, type ReportSnapshot, type SnapshotSelector } from "./snapshot.js";
import { notifyDiscord, discordOptions } from "../notify/discord.js";

// `--flag value` と `--flag=value` の両形に対応する。
// (npm 経由では `--flag value` が npm に横取りされるため `--flag=value` を推奨。)
function arg(flag: string): string | undefined {
  const eq = process.argv.find((a) => a.startsWith(`${flag}=`));
  if (eq) return eq.slice(flag.length + 1);
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function has(flag: string): boolean {
  return process.argv.includes(flag);
}

function parseSelector(): SnapshotSelector {
  const run = arg("--run");
  const label = arg("--label");
  if (run != null) {
    const runId = Number(run);
    if (!Number.isInteger(runId)) {
      console.error(`--run には数値の run-id を指定してください(例: --run=128)。`);
      process.exit(1);
    }
    return { runId };
  }
  if (label != null) return { label };
  return { latest: true };
}

/** Discord 本文用の短い案内(run-id と件数)。 */
function summaryLine(snap: ReportSnapshot): string {
  const runTag = snap.runId != null ? `run #${snap.runId}` : "run —";
  const c = snap.counts;
  return `🎨 **SignalSeeker** ${runTag} — HTMLインフォグラフィック（新規 ${c.new} / 更新 ${c.updated} / 繰越 ${c.carried}）`;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const sel = parseSelector();

  let snap: ReportSnapshot;
  try {
    snap = resolveSnapshot(sel);
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }

  // スナップショットから RunResult を再構成し、Markdown と同じモデルを組む(内容一致)。
  const result: RunResult = {
    runId: snap.runId,
    startedAt: snap.generatedAt,
    finishedAt: snap.generatedAt,
    summarized: snap.summarized,
    errors: [],
  };
  const model = buildReportModel(result, config.curation, snap.runId);
  model.date = snap.date; // 過去runの再描画では当時の日付を使う

  const html = renderHtml(model);
  const fileName = `report-${snap.runLabel}.html`;
  const path = join(PROJECT_ROOT, "data", "reports", fileName);
  writeFileSync(path, html, "utf-8");

  const runTag = snap.runId != null ? `run #${snap.runId}` : "run —";
  console.log(`インフォグラフィックを生成しました: ${path}`);
  console.log(`  対象: ${runTag} (${snap.date}) ・ ${model.total}件`);

  // 手動実行でも Discord へ送付する(HTMLを添付)。
  if (has("--no-discord")) {
    console.log("  --no-discord 指定のため Discord 送付はスキップしました。");
    return;
  }
  if (!config.notify.targets.includes("discord")) {
    console.log("  config の notify.targets に discord が無いため Discord 送付はスキップしました。");
    return;
  }
  try {
    await notifyDiscord(
      summaryLine(snap),
      { name: fileName, data: html, mimeType: "text/html" },
      discordOptions(config.runtime),
    );
  } catch (err) {
    console.error(`  Discord 送付に失敗しました: ${(err as Error).message}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("致命的エラー:", (err as Error).message);
  process.exit(1);
});
