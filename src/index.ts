import { loadConfig, loadSources } from "./config.js";
import { SqliteStore, kindToState, type UpsertKind } from "./db.js";
import { collectAll } from "./collector/index.js";
import { enrichAttention } from "./collector/attention.js";
import { summarizeItems } from "./summarizer/index.js";
import { dispatchNotify } from "./notify/index.js";
import { buildWiki } from "./wiki/index.js";
import { Logger } from "./logger.js";
import type { ItemState, RunResult, SummarizedItem } from "./types.js";

const keyOf = (sourceId: string, itemKey: string) => `${sourceId} ${itemKey}`;

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const resume = process.argv.includes("--resume");
  const startedAt = new Date().toISOString();

  const config = loadConfig();
  const sources = loadSources();
  const logger = new Logger(config.runtime.logging);
  logger.info("run_start", {
    sources: sources.length,
    provider: config.llm.endpoint.providerType,
    model: config.llm.endpoint.model,
    dryRun,
    resume,
  });
  console.log(
    `SignalSeeker 開始 (${sources.length}ソース, provider=${config.llm.endpoint.providerType}/${config.llm.endpoint.model}${dryRun ? ", dry-run" : ""}${resume ? ", resume" : ""})`,
  );
  console.log(`  ログ: ${logger.path}`);

  const store = new SqliteStore();

  // 前回の中断を検出して通知
  const interrupted = store.findInterruptedRuns();
  if (interrupted.length > 0) {
    logger.warn("previous_run_interrupted", { count: interrupted.length, runs: interrupted });
    console.warn(`  ⚠ 前回 ${interrupted.length} 件の実行が未完了でした。未要約・未配信分は本実行で再開します。`);
  }

  const runId = store.startRun(dryRun, logger.runLabel);
  store.markStaleRunsInterrupted(runId);
  const errors: RunResult["errors"] = [];

  try {
    const stateByKey = new Map<string, UpsertKind>();

    // 1. Collect — --resume 時は収集をスキップし、DBの未処理分から再開
    if (resume) {
      console.log("[1/4] 収集スキップ(--resume): DBの未処理分を再開します");
      logger.info("collect_skipped_resume");
    } else {
      console.log("[1/4] 収集中…");
      const { items, errors: collectErrors } = await collectAll(
        sources,
        config.firstRunLimit,
        config.collect,
        config.runtime,
        logger,
      );
      errors.push(...collectErrors);

      const sourceMap = new Map(sources.map((s) => [s.id, s]));
      for (const item of items) {
        const src = sourceMap.get(item.sourceId);
        const kind = store.upsert(item, src?.category ?? "未分類", src?.name ?? item.sourceId, runId);
        stateByKey.set(keyOf(item.sourceId, item.itemKey), kind);
      }
      const nNew = [...stateByKey.values()].filter((k) => k === "new").length;
      const nUpd = [...stateByKey.values()].filter((k) => k === "updated").length;
      console.log(`  新規 ${nNew}件 / 更新 ${nUpd}件`);
      logger.info("collect_done", { collected: items.length, new: nNew, updated: nUpd });

      // 1.5 注目度シグナル — 収集した記事に「現地での注目度」を付与・永続化(差分ノイズ抑制後の最新値)
      if (config.curation.enrichAttention) {
        console.log("  注目度シグナル取得中…");
        const atts = await enrichAttention(items, sources, config.curation, logger);
        for (const a of atts) store.setAttention(a.sourceId, a.itemKey, a.attention);
      }
    }

    // 2. Summarize — 未配信かつ未要約のものだけ(逐次永続化で再開可能)
    console.log("[2/4] 要約中…");
    const needing = store.itemsNeedingSummary();
    logger.info("summarize_start", { count: needing.length });
    const summaries = await summarizeItems(needing, config, logger);
    let okCount = 0;
    for (const r of summaries) {
      if (r.summary) {
        store.setSummary(r.sourceId, r.itemKey, r.summary);
        okCount++;
      }
    }
    logger.info("summarize_done", { ok: okCount, failed: summaries.length - okCount });

    // 3. Report — 未配信(reported=0)の全件。過去dry/中断分も繰り越して載せる
    console.log("[3/4] レポート生成・通知…");
    const pending = store.pendingItems();
    const summarized: SummarizedItem[] = pending.map((p) => {
      const kind = stateByKey.get(keyOf(p.sourceId, p.itemKey));
      const state: ItemState = kind ? kindToState(kind) : "carried";
      return {
        sourceId: p.sourceId,
        itemKey: p.itemKey,
        title: p.title,
        url: p.url,
        publishedAt: p.publishedAt,
        contentHash: p.contentHash,
        rawText: p.rawText,
        sourceName: p.sourceName,
        category: p.category,
        summary: p.summary,
        attention: p.attention,
        state,
      };
    });
    const result: RunResult = { startedAt, finishedAt: new Date().toISOString(), summarized, errors };
    await dispatchNotify(result, config, dryRun, logger);

    // 4. Wiki — DB の要約済み全件から Obsidian vault を再生成(非AI・冪等)
    if (config.wiki.enabled) {
      console.log("[4/4] Wiki 生成…");
      const { vault, noteCount } = buildWiki(store.allSummarizedItems(), config.wiki, config.curation);
      console.log(`  Wiki: ${vault} (${noteCount}件)`);
      logger.info("wiki_built", { vault, noteCount });
    }

    // 配信済みにするのは「要約に成功した記事」だけ。要約失敗(summary=null)分は
    // reported=0 のまま残し、次回実行の itemsNeedingSummary() で自動再要約させる(穴埋め)。
    let reportedCount = 0;
    if (!dryRun) {
      const done = pending.filter((p) => p.summary);
      store.markReported(done.map((p) => ({ sourceId: p.sourceId, itemKey: p.itemKey })));
      reportedCount = done.length;
      const carried = pending.length - done.length;
      if (carried > 0) {
        console.warn(`  ⚠ ${carried}件は要約失敗のため未配信のまま保持(次回実行で再要約します)`);
        logger.warn("items_carried_unsummarized", { count: carried });
      }
    } else {
      console.log(`[dry-run] ${pending.length}件は未配信のまま保持(次の本実行で配信されます)`);
    }

    store.finishRun(runId, "completed", okCount, errors.length ? JSON.stringify(errors) : undefined);
    logger.info("run_completed", { reported: dryRun ? 0 : reportedCount });
    console.log("完了。");
  } catch (err) {
    const message = (err as Error).message;
    store.finishRun(runId, "failed", 0, message);
    logger.error("run_failed", { message });
    throw err;
  } finally {
    store.close();
  }
}

main().catch((err) => {
  console.error("致命的エラー:", (err as Error).message);
  process.exit(1);
});
