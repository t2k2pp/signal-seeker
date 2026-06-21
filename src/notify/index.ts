import type { AppConfig, RunResult } from "../types.js";
import { buildMarkdown } from "../report/markdown.js";
import { notifyConsole } from "./console.js";
import { notifyDiscord } from "./discord.js";

/**
 * 有効な通知先へ fan-out する。console は常にファイル保存も行う。
 * dryRun=true なら通知(discord)は行わずレポート生成・保存のみ。
 */
export async function dispatchNotify(
  result: RunResult,
  config: AppConfig,
  dryRun: boolean,
): Promise<void> {
  const markdown = buildMarkdown(result);

  // console はレポート生成の確認用に常に実行
  notifyConsole(markdown);

  if (dryRun) {
    console.log("[notify] --dry-run のため外部通知はスキップしました。");
    return;
  }

  if (config.notify.targets.includes("discord")) {
    try {
      await notifyDiscord(result.summarized);
    } catch (err) {
      console.warn(`[notify] discord 失敗: ${(err as Error).message}`);
    }
  }
}
