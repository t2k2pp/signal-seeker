import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PROJECT_ROOT } from "../config.js";

/** 標準出力へ表示しつつ data/reports/<date>.md に保存する(常時実行の動作確認用)。 */
export function notifyConsole(markdown: string): string {
  const dir = join(PROJECT_ROOT, "data", "reports");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${new Date().toISOString().slice(0, 10)}.md`);
  writeFileSync(path, markdown, "utf-8");

  console.log("\n" + "=".repeat(60));
  console.log(markdown);
  console.log("=".repeat(60));
  console.log(`\n[report] 保存: ${path}`);
  return path;
}
