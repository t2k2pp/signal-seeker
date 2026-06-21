import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { PROJECT_ROOT } from "./config.js";
import type { Item, ItemState, StoredItem } from "./types.js";

const DATA_DIR = join(PROJECT_ROOT, "data");

/** title+rawText から安定したハッシュを作る。差分判定の基準。 */
export function hashContent(title: string, rawText: string): string {
  return createHash("sha256").update(`${title}\n${rawText}`).digest("hex");
}

/** upsert 時の判定結果。レポートのバッジ(新規/更新)に使う。 */
export type UpsertKind = "new" | "updated" | "unchanged";

interface ItemRow {
  source_id: string;
  item_key: string;
  title: string;
  url: string;
  published_at: string | null;
  content_hash: string;
  raw_text: string;
  category: string;
  source_name: string;
  summary: string | null;
  reported: number;
  first_seen_at: string;
  last_seen_at: string;
}

function rowToStored(r: ItemRow): StoredItem {
  return {
    sourceId: r.source_id,
    itemKey: r.item_key,
    title: r.title,
    url: r.url,
    publishedAt: r.published_at,
    contentHash: r.content_hash,
    rawText: r.raw_text,
    category: r.category,
    sourceName: r.source_name,
    summary: r.summary,
    reported: r.reported === 1,
    firstSeenAt: r.first_seen_at,
    lastSeenAt: r.last_seen_at,
  };
}

export class Store {
  private db: Database.Database;

  constructor(dbPath = join(DATA_DIR, "signalseeker.db")) {
    mkdirSync(DATA_DIR, { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS items (
        source_id     TEXT NOT NULL,
        item_key      TEXT NOT NULL,
        title         TEXT NOT NULL,
        url           TEXT NOT NULL,
        published_at  TEXT,
        content_hash  TEXT NOT NULL,
        raw_text      TEXT NOT NULL,
        category      TEXT NOT NULL DEFAULT '未分類',
        source_name   TEXT NOT NULL DEFAULT '',
        summary       TEXT,
        reported      INTEGER NOT NULL DEFAULT 0,
        first_seen_at TEXT NOT NULL,
        last_seen_at  TEXT NOT NULL,
        PRIMARY KEY (source_id, item_key)
      );
      CREATE TABLE IF NOT EXISTS runs (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at  TEXT NOT NULL,
        finished_at TEXT,
        dry_run     INTEGER NOT NULL DEFAULT 0,
        status      TEXT NOT NULL DEFAULT 'running',
        log_label   TEXT,
        new_count   INTEGER NOT NULL DEFAULT 0,
        error       TEXT
      );
    `);
    // 旧スキーマ(summarized 列など)からの緩い移行: 不足列を追加
    const cols = new Set(
      (this.db.prepare("PRAGMA table_info(items)").all() as { name: string }[]).map((c) => c.name),
    );
    const addIfMissing = (name: string, ddl: string) => {
      if (!cols.has(name)) this.db.exec(`ALTER TABLE items ADD COLUMN ${ddl}`);
    };
    addIfMissing("category", "category TEXT NOT NULL DEFAULT '未分類'");
    addIfMissing("source_name", "source_name TEXT NOT NULL DEFAULT ''");
    addIfMissing("summary", "summary TEXT");
    addIfMissing("reported", "reported INTEGER NOT NULL DEFAULT 0");

    const runCols = new Set(
      (this.db.prepare("PRAGMA table_info(runs)").all() as { name: string }[]).map((c) => c.name),
    );
    if (!runCols.has("status")) this.db.exec("ALTER TABLE runs ADD COLUMN status TEXT NOT NULL DEFAULT 'running'");
    if (!runCols.has("log_label")) this.db.exec("ALTER TABLE runs ADD COLUMN log_label TEXT");
  }

  /**
   * 収集 Item を upsert する。dry/本実行に関わらず呼ぶ。
   * - 新規: 挿入 (reported=0, summary=null)
   * - 本文変化: 更新し reported=0, summary=null にリセット (再要約対象)
   * - 変化なし: last_seen_at のみ更新 (reported/summary は維持)
   * reported を消費しないため、dry実行で入れた記事も本実行で取り込まれる。
   */
  upsert(item: Item, category: string, sourceName: string): UpsertKind {
    const now = new Date().toISOString();
    const existing = this.db
      .prepare("SELECT content_hash FROM items WHERE source_id = ? AND item_key = ?")
      .get(item.sourceId, item.itemKey) as { content_hash: string } | undefined;

    if (!existing) {
      this.db
        .prepare(
          `INSERT INTO items (source_id, item_key, title, url, published_at, content_hash, raw_text, category, source_name, summary, reported, first_seen_at, last_seen_at)
           VALUES (@sourceId, @itemKey, @title, @url, @publishedAt, @contentHash, @rawText, @category, @sourceName, NULL, 0, @now, @now)`,
        )
        .run({ ...item, category, sourceName, now });
      return "new";
    }
    if (existing.content_hash !== item.contentHash) {
      this.db
        .prepare(
          `UPDATE items SET title=@title, url=@url, published_at=@publishedAt, content_hash=@contentHash,
             raw_text=@rawText, category=@category, source_name=@sourceName, summary=NULL, reported=0, last_seen_at=@now
           WHERE source_id=@sourceId AND item_key=@itemKey`,
        )
        .run({ ...item, category, sourceName, now });
      return "updated";
    }
    // 変化なし: メタ(category/source_name)は最新に追従させ last_seen を更新
    this.db
      .prepare(
        "UPDATE items SET last_seen_at=?, category=?, source_name=? WHERE source_id=? AND item_key=?",
      )
      .run(now, category, sourceName, item.sourceId, item.itemKey);
    return "unchanged";
  }

  /** 未配信(reported=0)かつ未要約(summary IS NULL)の記事 = 今要約すべき対象。 */
  itemsNeedingSummary(): StoredItem[] {
    const rows = this.db
      .prepare("SELECT * FROM items WHERE reported = 0 AND summary IS NULL ORDER BY first_seen_at")
      .all() as ItemRow[];
    return rows.map(rowToStored);
  }

  setSummary(sourceId: string, itemKey: string, summary: string): void {
    this.db
      .prepare("UPDATE items SET summary = ? WHERE source_id = ? AND item_key = ?")
      .run(summary, sourceId, itemKey);
  }

  /** 未配信(reported=0)の記事すべて = 次のレポートに載せる対象(過去dry分も含む)。 */
  pendingItems(): StoredItem[] {
    const rows = this.db
      .prepare("SELECT * FROM items WHERE reported = 0 ORDER BY category, source_name, first_seen_at")
      .all() as ItemRow[];
    return rows.map(rowToStored);
  }

  /** 本実行でレポートに載せた記事を配信済みにする。 */
  markReported(keys: { sourceId: string; itemKey: string }[]): void {
    const stmt = this.db.prepare(
      "UPDATE items SET reported = 1 WHERE source_id = ? AND item_key = ?",
    );
    const tx = this.db.transaction((ks: typeof keys) => {
      for (const k of ks) stmt.run(k.sourceId, k.itemKey);
    });
    tx(keys);
  }

  /** Wiki 生成用: 要約済みの全記事(履歴含む)。 */
  allSummarizedItems(): StoredItem[] {
    const rows = this.db
      .prepare("SELECT * FROM items WHERE summary IS NOT NULL ORDER BY category, source_name, COALESCE(published_at, first_seen_at) DESC")
      .all() as ItemRow[];
    return rows.map(rowToStored);
  }

  // ---- 開発者向け閲覧クエリ(db-view CLI) ----

  stats(): {
    total: number;
    summarized: number;
    pending: number;
    needingSummary: number;
    byCategory: { category: string; count: number }[];
    bySource: { sourceName: string; count: number }[];
  } {
    const scalar = (sql: string) => (this.db.prepare(sql).get() as { c: number }).c;
    return {
      total: scalar("SELECT COUNT(*) c FROM items"),
      summarized: scalar("SELECT COUNT(*) c FROM items WHERE summary IS NOT NULL"),
      pending: scalar("SELECT COUNT(*) c FROM items WHERE reported = 0"),
      needingSummary: scalar("SELECT COUNT(*) c FROM items WHERE reported = 0 AND summary IS NULL"),
      byCategory: this.db
        .prepare("SELECT category, COUNT(*) count FROM items GROUP BY category ORDER BY count DESC")
        .all() as { category: string; count: number }[],
      bySource: this.db
        .prepare("SELECT source_name AS sourceName, COUNT(*) count FROM items GROUP BY source_name ORDER BY count DESC")
        .all() as { sourceName: string; count: number }[],
    };
  }

  listItems(filter: {
    sourceId?: string;
    pending?: boolean;
    needing?: boolean;
    reported?: boolean;
    limit?: number;
  }): StoredItem[] {
    const where: string[] = [];
    const args: unknown[] = [];
    if (filter.sourceId) {
      where.push("source_id = ?");
      args.push(filter.sourceId);
    }
    if (filter.pending) where.push("reported = 0");
    if (filter.reported) where.push("reported = 1");
    if (filter.needing) where.push("reported = 0 AND summary IS NULL");
    const sql = `SELECT * FROM items ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY last_seen_at DESC LIMIT ?`;
    args.push(filter.limit ?? 50);
    return (this.db.prepare(sql).all(...args) as ItemRow[]).map(rowToStored);
  }

  searchItems(text: string, limit = 50): StoredItem[] {
    const like = `%${text}%`;
    return (
      this.db
        .prepare(
          "SELECT * FROM items WHERE title LIKE ? OR summary LIKE ? OR raw_text LIKE ? ORDER BY last_seen_at DESC LIMIT ?",
        )
        .all(like, like, like, limit) as ItemRow[]
    ).map(rowToStored);
  }

  getItem(sourceId: string, itemKey: string): StoredItem | null {
    const row = this.db
      .prepare("SELECT * FROM items WHERE source_id = ? AND item_key = ?")
      .get(sourceId, itemKey) as ItemRow | undefined;
    return row ? rowToStored(row) : null;
  }

  recentRuns(limit = 20): {
    id: number;
    started_at: string;
    finished_at: string | null;
    dry_run: number;
    status: string;
    new_count: number;
    log_label: string | null;
    error: string | null;
  }[] {
    return this.db
      .prepare("SELECT id, started_at, finished_at, dry_run, status, new_count, log_label, error FROM runs ORDER BY id DESC LIMIT ?")
      .all(limit) as never;
  }

  startRun(dryRun: boolean, logLabel: string): number {
    const info = this.db
      .prepare("INSERT INTO runs (started_at, dry_run, status, log_label) VALUES (?, ?, 'running', ?)")
      .run(new Date().toISOString(), dryRun ? 1 : 0, logLabel);
    return Number(info.lastInsertRowid);
  }

  finishRun(runId: number, status: "completed" | "failed", newCount: number, error?: string): void {
    this.db
      .prepare("UPDATE runs SET finished_at = ?, status = ?, new_count = ?, error = ? WHERE id = ?")
      .run(new Date().toISOString(), status, newCount, error ?? null, runId);
  }

  /** 前回までに完了しなかった(status='running' のまま残った)実行。中断検出用。 */
  findInterruptedRuns(): { id: number; started_at: string; log_label: string | null }[] {
    return this.db
      .prepare("SELECT id, started_at, log_label FROM runs WHERE status = 'running' AND finished_at IS NULL ORDER BY id")
      .all() as { id: number; started_at: string; log_label: string | null }[];
  }

  /** 起動時、過去の running を interrupted として確定させる(当該runを除く)。 */
  markStaleRunsInterrupted(exceptRunId: number): number {
    const info = this.db
      .prepare("UPDATE runs SET status = 'interrupted' WHERE status = 'running' AND id != ?")
      .run(exceptRunId);
    return info.changes;
  }

  close(): void {
    this.db.close();
  }
}

/** UpsertKind を ItemState(レポート表示用)へ。unchanged は繰越扱い。 */
export function kindToState(kind: UpsertKind): ItemState {
  return kind === "new" ? "new" : kind === "updated" ? "updated" : "carried";
}
