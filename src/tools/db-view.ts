// 開発者向け signalseeker.db 閲覧CLI。  npm run db -- --channel=<id> <cmd> [opts]
//   stats                              集計(既定)
//   items [--source ID] [--pending] [--needing] [--reported] [--limit N]
//   runs [--limit N]                   実行履歴(status/時間/件数/ログ)
//   search <text> [--limit N]          全文(LIKE)検索
//   item <sourceId> <itemKey>          1件の詳細(要約・本文込み)
import { SqliteStore } from "../db.js";
import { channelsOrExit, resolveChannel } from "../channel.js";

function arg(flag: string): string | undefined {
  const eq = process.argv.find((a) => a.startsWith(`${flag}=`));
  if (eq) return eq.slice(flag.length + 1);
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function has(flag: string): boolean {
  return process.argv.includes(flag);
}
function num(flag: string, def: number): number {
  const v = arg(flag);
  return v ? Number(v) : def;
}
function trunc(s: string, n: number): string {
  const oneLine = s.replace(/\s+/g, " ").trim();
  return oneLine.length <= n ? oneLine : oneLine.slice(0, n - 1) + "…";
}

// 位置引数(フラグと --channel/--source/--limit の値を除いた素のトークン)を抽出する。
const VALUE_FLAGS = new Set(["--channel", "--source", "--limit"]);
const positionals: string[] = [];
{
  const raw = process.argv.slice(2);
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i]!;
    if (a.startsWith("-")) {
      if (VALUE_FLAGS.has(a)) i++; // スペース区切りの値を読み飛ばす
      continue;
    }
    positionals.push(a);
  }
}

const ids = channelsOrExit();
if (ids.length !== 1) {
  console.error(`DB閲覧は1チャンネルを指定してください(--channel=<id>)。対象: ${ids.join(", ")}`);
  process.exit(1);
}
const channel = resolveChannel(ids[0]!);
const cmd = positionals[0] ?? "stats";
const store = new SqliteStore(channel.paths.db);

try {
  switch (cmd) {
    case "stats": {
      const s = store.stats();
      console.log("=== SignalSeeker DB 統計 ===");
      console.log(`総記事数: ${s.total}  要約済: ${s.summarized}  未配信(pending): ${s.pending}  未要約: ${s.needingSummary}`);
      console.log("\n[カテゴリ別]");
      for (const c of s.byCategory) console.log(`  ${String(c.count).padStart(5)}  ${c.category}`);
      console.log("\n[ソース別]");
      for (const c of s.bySource) console.log(`  ${String(c.count).padStart(5)}  ${c.sourceName}`);
      break;
    }
    case "items": {
      const items = store.listItems({
        sourceId: arg("--source"),
        pending: has("--pending"),
        needing: has("--needing"),
        reported: has("--reported"),
        limit: num("--limit", 50),
      });
      console.log(`=== items (${items.length}) ===`);
      for (const it of items) {
        const flags = `${it.summary ? "S" : "-"}${it.reported ? "R" : "-"}`;
        console.log(`[${flags}] ${it.category} / ${it.sourceName}`);
        console.log(`      ${trunc(it.title, 80)}`);
        console.log(`      ${it.url}`);
      }
      console.log("\n凡例: S=要約済 R=配信済");
      break;
    }
    case "runs": {
      const runs = store.recentRuns(num("--limit", 20));
      console.log("=== runs ===");
      for (const r of runs) {
        const kind = r.dry_run ? "dry " : "real";
        console.log(`#${r.id} [${r.status}] ${kind} 開始=${r.started_at} 終了=${r.finished_at ?? "-"} 新規=${r.new_count}`);
        if (r.log_label) console.log(`     log: ${channel.paths.logsDir}/run-${r.log_label}.jsonl`);
        if (r.error) console.log(`     error: ${trunc(r.error, 200)}`);
      }
      break;
    }
    case "search": {
      const text = positionals[1];
      if (!text) {
        console.error("使い方: npm run db -- --channel=<id> search <text> [--limit N]");
        process.exit(1);
      }
      const items = store.searchItems(text, num("--limit", 50));
      console.log(`=== search "${text}" (${items.length}) ===`);
      for (const it of items) {
        console.log(`- ${it.category} / ${it.sourceName}: ${trunc(it.title, 70)}`);
        console.log(`  ${it.url}`);
      }
      break;
    }
    case "item": {
      const sourceId = positionals[1];
      const itemKey = positionals[2];
      if (!sourceId || !itemKey) {
        console.error("使い方: npm run db -- --channel=<id> item <sourceId> <itemKey>");
        process.exit(1);
      }
      const it = store.getItem(sourceId, itemKey);
      if (!it) {
        console.log("該当なし");
        break;
      }
      console.log(`タイトル: ${it.title}`);
      console.log(`URL: ${it.url}`);
      console.log(`カテゴリ/ソース: ${it.category} / ${it.sourceName}`);
      console.log(`公開: ${it.publishedAt ?? "-"}  初収集: ${it.firstSeenAt}  更新: ${it.lastSeenAt}`);
      console.log(`要約済: ${it.summary ? "yes" : "no"}  配信済: ${it.reported ? "yes" : "no"}`);
      console.log(`\n--- 要約 ---\n${it.summary ?? "(なし)"}`);
      console.log(`\n--- 本文(抜粋) ---\n${trunc(it.rawText, 1000)}`);
      break;
    }
    default:
      console.error(`不明なコマンド: ${cmd}\n使えるコマンド: stats / items / runs / search / item`);
      process.exit(1);
  }
} finally {
  store.close();
}
