import type { AppConfig, RunResult } from "../types.js";
import { buildMarkdown } from "../report/markdown.js";
import { notifyConsole } from "./console.js";
import { notifyDiscord, discordOptions } from "./discord.js";
import type { Logger } from "../logger.js";

/**
 * 有効な通知先へ fan-out する。console は常にファイル保存も行う。
 * dryRun=true なら通知(discord)は行わずレポート生成・保存のみ。
 */
export async function dispatchNotify(
  result: RunResult,
  config: AppConfig,
  dryRun: boolean,
  logger: Logger,
): Promise<void> {
  const markdown = buildMarkdown(result);

  // console はレポート生成の確認用に常に実行。ファイル名は実行ラベルで一意化(1日複数回でも上書きしない)
  const reportPath = notifyConsole(markdown, logger.runLabel);
  logger.info("report_saved", { path: reportPath, items: result.summarized.length });

  if (dryRun) {
    logger.info("notify_skipped_dryrun");
    return;
  }

  if (config.notify.targets.includes("discord")) {
    try {
      await notifyDiscord(result.summarized, discordOptions(config.runtime));
      logger.info("discord_sent", { items: result.summarized.length });
    } catch (err) {
      logger.error("discord_failed", { message: (err as Error).message });
    }
  }
}
