// インフォグラフィック生成コマンド: 収集・要約をせず、保存済みスナップショットから
// レポートと同一内容の HTML(ダーク・ダッシュボード)を描画する。
//   npm run infographic -- --channel=<id> [--run=<id> | --label=<label> | --latest] [--no-discord]
// 既定は --latest。生成した HTML はチャンネルの Discord 投稿先にも添付送付する
// (config.notify.targets に discord があり webhook が設定されている場合。--no-discord で抑止)。
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { channelArg, resolveChannel, selectChannelIds } from "../channel.js";
import type { RunResult } from "../types.js";
import { buildReportModel } from "./model.js";
import { renderHtml } from "./html.js";
import { resolveSnapshot, type ReportSnapshot, type SnapshotSelector } from "./snapshot.js";
import { notifyDiscord, discordOptions } from "../notify/discord.js";

// `--flag value` と `--flag=value` の両形に対応する(npm 経由では `=` 形式を推奨)。
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

/** Discord 本文用の短い案内(チャンネル名 + run-id/期間 + 件数)。 */
function summaryLine(snap: ReportSnapshot, channelName: string): string {
  const total = snap.summarized.length;
  if (snap.kind === "weekly" && snap.period) {
    return `🗓 **SignalSeeker [${channelName}]** 週次 ${snap.period.start}〜${snap.period.end}（${snap.period.days}日間）— HTMLインフォグラフィック ${total}件`;
  }
  const runTag = snap.runId != null ? `run #${snap.runId}` : "run —";
  const c = snap.counts;
  return `🎨 **SignalSeeker [${channelName}]** ${runTag} — HTMLインフォグラフィック（新規 ${c.new} / 更新 ${c.updated} / 繰越 ${c.carried}）`;
}

async function main(): Promise<void> {
  // インフォグラフィックは1チャンネルを対象に描画する(all は対象外)。
  const ids = selectChannelIds(channelArg());
  if (ids.length !== 1) {
    console.error(`インフォグラフィックは1チャンネルを指定してください(--channel=<id>)。対象: ${ids.join(", ")}`);
    process.exit(1);
  }
  const channel = resolveChannel(ids[0]!);
  const config = channel.config;
  const sel = parseSelector();

  let snap: ReportSnapshot;
  try {
    snap = resolveSnapshot(channel.paths.reportsDir, sel);
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
  const model = buildReportModel(result, config.curation, {
    runId: snap.runId,
    date: snap.date, // 過去回の再描画では当時の日付/期間末を使う
    kind: snap.kind ?? "daily",
    period: snap.period ?? null,
    channelName: channel.name,
  });

  const html = renderHtml(model);
  const fileName = `report-${snap.runLabel}.html`;
  const path = join(channel.paths.reportsDir, fileName);
  writeFileSync(path, html, "utf-8");

  const runTag = snap.runId != null ? `run #${snap.runId}` : "run —";
  console.log(`インフォグラフィックを生成しました: ${path}`);
  console.log(`  チャンネル: [${channel.name}] / 対象: ${runTag} (${snap.date}) ・ ${model.total}件`);

  // 手動実行でもチャンネルの Discord へ送付する(HTMLを添付)。
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
      summaryLine(snap, channel.name),
      { name: fileName, data: html, mimeType: "text/html" },
      discordOptions(config.runtime),
      channel.discordWebhook,
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
