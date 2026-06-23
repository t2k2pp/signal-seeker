import type { AppConfig, RunResult } from "../types.js";
import { buildMarkdown } from "../report/markdown.js";
import { writeSnapshot } from "../report/snapshot.js";
import { notifyConsole } from "./console.js";
import { notifyDiscord, discordOptions } from "./discord.js";
import type { Logger } from "../logger.js";

/** Discord 本文用の短い件数サマリ(run-id 付き)を組み立てる。 */
function summaryLine(result: RunResult): string {
  const c = { new: 0, updated: 0, carried: 0 };
  for (const it of result.summarized) c[it.state]++;
  const runTag = result.runId != null ? `run #${result.runId}` : "run —";
  if (result.summarized.length === 0) {
    return `📡 SignalSeeker ${runTag} — 今回の新規・更新はありませんでした。`;
  }
  return (
    `📡 **SignalSeeker** ${runTag} — 新規 ${c.new} / 更新 ${c.updated} / 繰越 ${c.carried}\n` +
    `全文は添付の Markdown レポートを参照してください。`
  );
}

/**
 * 有効な通知先へ fan-out する。console は常にファイル保存も行う。
 * dryRun=true なら通知(discord)は行わずレポート生成・保存のみ。
 * 末尾でスナップショット(再描画の契約)を保存する(dry-run でも保存)。
 */
export async function dispatchNotify(
  result: RunResult,
  config: AppConfig,
  dryRun: boolean,
  logger: Logger,
): Promise<void> {
  const markdown = buildMarkdown(result, config.curation, result.runId);

  // console はレポート生成の確認用に常に実行。ファイル名は実行ラベルで一意化(1日複数回でも上書きしない)
  const reportPath = notifyConsole(markdown, logger.runLabel);
  logger.info("report_saved", { path: reportPath, items: result.summarized.length });

  // スナップショット = インフォグラフィック等の再描画の入力契約(収集・要約の再実行不要)
  const snapPath = writeSnapshot(result, logger.runLabel);
  logger.info("snapshot_saved", { path: snapPath, runId: result.runId });

  if (dryRun) {
    logger.info("notify_skipped_dryrun");
    return;
  }

  if (config.notify.targets.includes("discord")) {
    try {
      const fileName = `report-${logger.runLabel}.md`;
      await notifyDiscord(markdown, fileName, summaryLine(result), discordOptions(config.runtime));
      logger.info("discord_sent", { items: result.summarized.length });
    } catch (err) {
      logger.error("discord_failed", { message: (err as Error).message });
    }
  }
}
