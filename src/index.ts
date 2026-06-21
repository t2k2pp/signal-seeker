import { loadConfig, loadSources } from "./config.js";
import { Store } from "./db.js";
import { collectAll } from "./collector/index.js";
import { summarizeDiffs } from "./summarizer/index.js";
import { dispatchNotify } from "./notify/index.js";
import type { ItemDiff } from "./db.js";
import type { RunResult } from "./types.js";

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const startedAt = new Date().toISOString();

  const config = loadConfig();
  const sources = loadSources();
  console.log(`SignalSeeker 開始 (${sources.length}ソース, provider=${config.llm.endpoint.providerType}/${config.llm.endpoint.model}${dryRun ? ", dry-run" : ""})`);

  const store = new Store();
  const runId = store.startRun();
  const errors: RunResult["errors"] = [];

  try {
    // 1. Collect — Playwright/RSS で巡回
    console.log("[1/3] 収集中…");
    const { items, errors: collectErrors } = await collectAll(sources, config.firstRunLimit);
    errors.push(...collectErrors);

    // 差分判定 — 初回ソースは firstRunLimit で取り込んだ全件が差分になる
    const diffs: ItemDiff[] = store.reconcile(items);
    console.log(`  差分: 新規 ${diffs.filter((d) => d.kind === "new").length}件 / 更新 ${diffs.filter((d) => d.kind === "updated").length}件`);

    // 2. Summarize — 差分のみ生成AIで客観ファクト抽出
    console.log("[2/3] 要約中…");
    const summarized = await summarizeDiffs(diffs, sources, config);
    for (const s of summarized) {
      if (s.summary) store.markSummarized(s.sourceId, s.itemKey);
    }

    // 3. Report + Notify
    console.log("[3/3] レポート生成・通知…");
    const result: RunResult = {
      startedAt,
      finishedAt: new Date().toISOString(),
      summarized,
      errors,
    };
    await dispatchNotify(result, config, dryRun);

    store.finishRun(runId, diffs.length, errors.length ? JSON.stringify(errors) : undefined);
    console.log("完了。");
  } catch (err) {
    store.finishRun(runId, 0, (err as Error).message);
    throw err;
  } finally {
    store.close();
  }
}

main().catch((err) => {
  console.error("致命的エラー:", (err as Error).message);
  process.exit(1);
});
