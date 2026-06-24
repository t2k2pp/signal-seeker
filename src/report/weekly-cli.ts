// 週次相当(最大15日)レポート生成コマンド。新規取得はせず、蓄積済みデータを期間で切り出して整理する。
//   npm run weekly -- [--days=N] [--until=YYYY-MM-DD]
// - 期間の軸は「収集日(first_seen)」。終端は --until 指定値、無ければ最後の収集日。
// - 既定は終端から過去7日。--days は 1..15(最大15日。月次は別コマンドで対応予定)。
// 生成物: data/reports/report-weekly-<end>-<days>d.md と .json(スナップショット)。
// HTML化は別途 `npm run infographic -- --label=weekly-<end>-<days>d` を手動実行する。
import { loadConfig } from "../config.js";
import { SqliteStore } from "../db.js";
import type { ReportPeriod, RunResult, StoredItem, SummarizedItem } from "../types.js";
import { buildReportModel } from "./model.js";
import { renderMarkdown } from "./markdown.js";
import { writeSnapshot } from "./snapshot.js";
import { notifyConsole } from "../notify/console.js";

const MAX_DAYS = 15;
const DEFAULT_DAYS = 7;

// `--flag value` と `--flag=value` の両形に対応(npm 経由では `=` 形式を推奨)。
function arg(flag: string): string | undefined {
  const eq = process.argv.find((a) => a.startsWith(`${flag}=`));
  if (eq) return eq.slice(flag.length + 1);
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** YYYY-MM-DD の妥当性(存在する日付か)を厳密に判定する。 */
function isValidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** YYYY-MM-DD に delta 日を足した YYYY-MM-DD を返す(UTC)。 */
function addDays(dateStr: string, delta: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function parseDays(): number {
  const raw = arg("--days");
  if (raw == null) return DEFAULT_DAYS;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > MAX_DAYS) {
    console.error(`--days は 1〜${MAX_DAYS} の整数で指定してください(週次相当は最大${MAX_DAYS}日)。`);
    process.exit(1);
  }
  return n;
}

function parseUntil(): string | undefined {
  const raw = arg("--until");
  if (raw == null) return undefined;
  if (!isValidDate(raw)) {
    console.error(`--until は実在する YYYY-MM-DD で指定してください(例: --until=2026-06-20)。`);
    process.exit(1);
  }
  return raw;
}

const config = loadConfig();
const days = parseDays();
const until = parseUntil();
const store = new SqliteStore();

try {
  const all = store.allSummarizedItems();
  if (all.length === 0) {
    console.log("要約済みのデータがありません。先に npm run crawl を実行してください。");
    process.exit(0);
  }

  // 収集日(first_seen)の YYYY-MM-DD で窓を切る。終端=未指定なら最後の収集日。
  const end = until ?? all.reduce((m, it) => (it.firstSeenAt.slice(0, 10) > m ? it.firstSeenAt.slice(0, 10) : m), "0000-00-00");
  const start = addDays(end, -(days - 1));
  const period: ReportPeriod = { start, end, days };

  const inWindow = (it: StoredItem): boolean => {
    const d = it.firstSeenAt.slice(0, 10);
    return d >= start && d <= end;
  };
  const summarized: SummarizedItem[] = all.filter(inWindow).map((it) => ({
    sourceId: it.sourceId,
    itemKey: it.itemKey,
    title: it.title,
    url: it.url,
    publishedAt: it.publishedAt,
    contentHash: it.contentHash,
    rawText: it.rawText,
    sourceName: it.sourceName,
    category: it.category,
    summary: it.summary,
    attention: it.attention,
    state: "new", // 週次では状態バッジを出さない(描画側で省略)。型を満たすための値。
  }));

  const now = new Date().toISOString();
  const result: RunResult = { runId: null, startedAt: now, finishedAt: now, summarized, errors: [] };

  const model = buildReportModel(result, config.curation, { runId: null, date: end, kind: "weekly", period });
  const markdown = renderMarkdown(model);

  const label = `weekly-${end}-${days}d`;
  const mdPath = notifyConsole(markdown, label);
  writeSnapshot(result, label, { kind: "weekly", period });

  console.log(`\n週次レポートを生成しました(${start} 〜 ${end}・${days}日間・${summarized.length}件)`);
  console.log(`  Markdown: ${mdPath}`);
  console.log(`  HTML化(任意): npm run infographic -- --label=${label}`);
} finally {
  store.close();
}
