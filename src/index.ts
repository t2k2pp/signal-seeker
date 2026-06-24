import { SqliteStore, kindToState, type UpsertKind } from "./db.js";
import { collectAll } from "./collector/index.js";
import { enrichAttention } from "./collector/attention.js";
import { summarizeItems } from "./summarizer/index.js";
import { dispatchNotify } from "./notify/index.js";
import { buildWiki } from "./wiki/index.js";
import { Logger } from "./logger.js";
import { channelArg, resolveChannel, selectChannelIds, type ResolvedChannel } from "./channel.js";
import type { ItemState, RunResult, SummarizedItem } from "./types.js";

const keyOf = (sourceId: string, itemKey: string) => `${sourceId} ${itemKey}`;

/** 1チャンネル分のパイプライン(収集→要約→レポート/通知→Wiki)。箱・通知先はチャンネルごとに分離。 */
async function runChannel(channel: ResolvedChannel, dryRun: boolean, resume: boolean): Promise<void> {
  const { config, sources, paths, name } = channel;
  const startedAt = new Date().toISOString();
  const logger = new Logger({ ...config.runtime.logging, dir: paths.logsDir });
  logger.info("run_start", {
    channel: channel.id,
    sources: sources.length,
    provider: config.llm.endpoint.providerType,
    model: config.llm.endpoint.model,
    dryRun,
    resume,
  });
  console.log(
    `\n=== チャンネル [${name}] (${channel.id}) === ${sources.length}ソース, provider=${config.llm.endpoint.providerType}/${config.llm.endpoint.model}${dryRun ? ", dry-run" : ""}${resume ? ", resume" : ""}`,
  );
  console.log(`  DB: ${paths.db}`);
  console.log(`  ログ: ${logger.path}`);

  const store = new SqliteStore(paths.db);

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

      // 1.5 注目度シグナル
      if (config.curation.enrichAttention) {
        console.log("  注目度シグナル取得中…");
        const atts = await enrichAttention(items, sources, config.curation, logger);
        for (const a of atts) store.setAttention(a.sourceId, a.itemKey, a.attention);
      }
    }

    // 2. Summarize — チャンネルの抽出観点(systemPrompt)で要約
    console.log("[2/4] 要約中…");
    const needing = store.itemsNeedingSummary();
    logger.info("summarize_start", { count: needing.length });
    const summaries = await summarizeItems(needing, config, logger, channel.systemPrompt);
    let okCount = 0;
    for (const r of summaries) {
      if (r.summary) {
        store.setSummary(r.sourceId, r.itemKey, r.summary);
        okCount++;
      }
    }
    logger.info("summarize_done", { ok: okCount, failed: summaries.length - okCount });

    // 3. Report — 未配信(reported=0)の全件
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
    const result: RunResult = { runId, startedAt, finishedAt: new Date().toISOString(), summarized, errors };
    await dispatchNotify(result, channel, dryRun, logger);

    // 4. Wiki — チャンネル専用 vault に再生成
    if (config.wiki.enabled) {
      console.log("[4/4] Wiki 生成…");
      const { vault, noteCount } = buildWiki(
        store.allSummarizedItems(),
        { ...config.wiki, vaultPath: paths.wikiVault },
        config.curation,
      );
      console.log(`  Wiki: ${vault} (${noteCount}件)`);
      logger.info("wiki_built", { vault, noteCount });
    }

    // 配信済みにするのは要約に成功した記事だけ(失敗分は次回再要約)
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
    console.log(`  完了 [${name}]。`);
  } catch (err) {
    const message = (err as Error).message;
    store.finishRun(runId, "failed", 0, message);
    logger.error("run_failed", { message });
    throw err;
  } finally {
    store.close();
  }
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const resume = process.argv.includes("--resume");
  const ids = selectChannelIds(channelArg());

  console.log(`SignalSeeker 開始: ${ids.length}チャンネル [${ids.join(", ")}]`);
  for (const id of ids) {
    await runChannel(resolveChannel(id), dryRun, resume);
  }
  console.log("\nすべてのチャンネルが完了しました。");
}

main().catch((err) => {
  console.error("致命的エラー:", (err as Error).message);
  process.exit(1);
});
