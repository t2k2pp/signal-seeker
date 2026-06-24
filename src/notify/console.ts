import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 標準出力へ表示しつつ <reportsDir>/report-<runLabel>.md に保存する。
 * runLabel は実行ごとに一意(ISO時刻ベース)なので、1日に複数回実行しても上書きされない。
 */
export function notifyConsole(markdown: string, runLabel: string, reportsDir: string): string {
  mkdirSync(reportsDir, { recursive: true });
  const path = join(reportsDir, `report-${runLabel}.md`);
  writeFileSync(path, markdown, "utf-8");

  console.log("\n" + "=".repeat(60));
  console.log(markdown);
  console.log("=".repeat(60));
  console.log(`\n[report] 保存: ${path}`);
  return path;
}
