import type { RunResult } from "../types.js";
import type { ResolvedChannel } from "../channel.js";
import { buildMarkdown } from "../report/markdown.js";
import { writeSnapshot } from "../report/snapshot.js";
import { notifyConsole } from "./console.js";
import { notifyDiscord, discordOptions } from "./discord.js";
import type { Logger } from "../logger.js";

/** Discord 本文用の短い件数サマリ(チャンネル名 + run-id 付き)。 */
function summaryLine(result: RunResult, channelName: string): string {
  const c = { new: 0, updated: 0, carried: 0 };
  for (const it of result.summarized) c[it.state]++;
  const runTag = result.runId != null ? `run #${result.runId}` : "run —";
  const tag = `📡 **SignalSeeker [${channelName}]** ${runTag}`;
  if (result.summarized.length === 0) {
    return `${tag} — 今回の新規・更新はありませんでした。`;
  }
  return `${tag} — 新規 ${c.new} / 更新 ${c.updated} / 繰越 ${c.carried}\n全文は添付の Markdown レポートを参照してください。`;
}

/**
 * チャンネルの有効な通知先へ fan-out する。console は常にファイル保存も行う。
 * dryRun=true なら通知(discord)は行わずレポート生成・保存のみ。
 * 出力先(reports)・Discord webhook はチャンネルごとに分かれる。
 */
export async function dispatchNotify(
  result: RunResult,
  channel: ResolvedChannel,
  dryRun: boolean,
  logger: Logger,
): Promise<void> {
  const { config, paths, name: channelName } = channel;
  const markdown = buildMarkdown(result, config.curation, result.runId, channelName);

  // console はレポート生成の確認用に常に実行。ファイル名は実行ラベルで一意化(1日複数回でも上書きしない)
  const reportPath = notifyConsole(markdown, logger.runLabel, paths.reportsDir);
  logger.info("report_saved", { path: reportPath, items: result.summarized.length });

  // スナップショット = インフォグラフィック等の再描画の入力契約(収集・要約の再実行不要)
  const snapPath = writeSnapshot(result, logger.runLabel, paths.reportsDir);
  logger.info("snapshot_saved", { path: snapPath, runId: result.runId });

  if (dryRun) {
    logger.info("notify_skipped_dryrun");
    return;
  }

  if (config.notify.targets.includes("discord")) {
    try {
      const fileName = `report-${logger.runLabel}.md`;
      await notifyDiscord(
        summaryLine(result, channelName),
        { name: fileName, data: markdown, mimeType: "text/markdown" },
        discordOptions(config.runtime),
        channel.discordWebhook,
      );
      logger.info("discord_sent", { items: result.summarized.length });
    } catch (err) {
      logger.error("discord_failed", { message: (err as Error).message });
    }
  }
}
