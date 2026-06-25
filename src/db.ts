import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { PROJECT_ROOT } from "./config.js";
import type { AttentionMetrics, Item, ItemState, StoredItem } from "./types.js";

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
  attention: string | null;
  first_seen_at: string;
  last_seen_at: string;
}

function parseAttention(json: string | null): AttentionMetrics | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as AttentionMetrics;
  } catch {
    return null;
  }
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
    attention: parseAttention(r.attention),
    firstSeenAt: r.first_seen_at,
    lastSeenAt: r.last_seen_at,
  };
}

// ---- 永続化の契約(差し替え先の明文化) ----
// 生SQLは本ファイルのみに閉じる。別DBへ移す場合は Store を実装した新クラスを作り、
// 呼び出し側(index/wiki/db-view)はそのインスタンスを使うだけにする。
// 注意: 現実装(better-sqlite3)は同期。非同期ドライバへ移す場合は本 interface を
// Promise 返しに変更し呼び出し側へ await を波及させる必要がある(設計書参照)。

export interface Stats {
  total: number;
  summarized: number;
  pending: number;
  needingSummary: number;
  byCategory: { category: string; count: number }[];
  bySource: { sourceName: string; count: number }[];
}

export interface RunRow {
  id: number;
  started_at: string;
  finished_at: string | null;
  dry_run: number;
  status: string;
  new_count: number;
  log_label: string | null;
  error: string | null;
}

export interface ItemFilter {
  sourceId?: string;
  pending?: boolean;
  needing?: boolean;
  reported?: boolean;
  limit?: number;
}

export interface InterruptedRun {
  id: number;
  started_at: string;
  log_label: string | null;
}

/** 永続化バックエンドの契約。SqliteStore が実装。別DBはこれを実装すれば差し替わる。 */
export interface Store {
  upsert(item: Item, category: string, sourceName: string, runId: number): UpsertKind;
  itemsNeedingSummary(): StoredItem[];
  setSummary(sourceId: string, itemKey: string, summary: string): void;
  setAttention(sourceId: string, itemKey: string, attention: AttentionMetrics): void;
  pendingItems(): StoredItem[];
  markReported(keys: { sourceId: string; itemKey: string }[]): void;
  allSummarizedItems(): StoredItem[];
  stats(): Stats;
  listItems(filter: ItemFilter): StoredItem[];
  searchItems(text: string, limit?: number): StoredItem[];
  getItem(sourceId: string, itemKey: string): StoredItem | null;
  searchItemsFts(text: string, limit?: number): StoredItem[];
  ftsAvailable(): boolean;
  recentRuns(limit?: number): RunRow[];
  startRun(dryRun: boolean, logLabel: string): number;
  finishRun(runId: number, status: "completed" | "failed", newCount: number, error?: string): void;
  findInterruptedRuns(): InterruptedRun[];
  markStaleRunsInterrupted(exceptRunId: number): number;
  close(): void;
}

export class SqliteStore implements Store {
  private db: Database.Database;

  constructor(dbPath = join(DATA_DIR, "signalseeker.db"), opts: { readonly?: boolean } = {}) {
    if (opts.readonly) {
      // 読み取り専用(Webサーバ用)。DBはCLIが作成・マイグレ済み前提。
      // mkdir / WAL pragma / migrate(=書き込み)は行わない。WAL読みは収集中でも安全。
      this.db = new Database(dbPath, { readonly: true, fileMustExist: true });
      return;
    }
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
        attention     TEXT,
        first_seen_run INTEGER,
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
    addIfMissing("attention", "attention TEXT");
    addIfMissing("first_seen_run", "first_seen_run INTEGER");

    const runCols = new Set(
      (this.db.prepare("PRAGMA table_info(runs)").all() as { name: string }[]).map((c) => c.name),
    );
    if (!runCols.has("status")) this.db.exec("ALTER TABLE runs ADD COLUMN status TEXT NOT NULL DEFAULT 'running'");
    if (!runCols.has("log_label")) this.db.exec("ALTER TABLE runs ADD COLUMN log_label TEXT");

    this.migrateFts();
  }

  /**
   * 全文検索(FTS5)を用意する。日本語(分かち書きなし)に対応するため trigram トークナイザを使う
   * (3文字以上の部分一致を索引で引ける)。items への INSERT/UPDATE/DELETE をトリガで常時同期し、
   * 既存データには初回バックフィルする。Web の横断検索が高速・実用的になる。
   */
  private migrateFts(): void {
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
        source_id UNINDEXED, item_key UNINDEXED,
        title, summary, raw_text,
        tokenize='trigram'
      );
      CREATE TRIGGER IF NOT EXISTS items_fts_ai AFTER INSERT ON items BEGIN
        INSERT INTO items_fts(rowid, source_id, item_key, title, summary, raw_text)
        VALUES (new.rowid, new.source_id, new.item_key, new.title, COALESCE(new.summary,''), new.raw_text);
      END;
      CREATE TRIGGER IF NOT EXISTS items_fts_ad AFTER DELETE ON items BEGIN
        DELETE FROM items_fts WHERE rowid = old.rowid;
      END;
      CREATE TRIGGER IF NOT EXISTS items_fts_au AFTER UPDATE ON items BEGIN
        DELETE FROM items_fts WHERE rowid = old.rowid;
        INSERT INTO items_fts(rowid, source_id, item_key, title, summary, raw_text)
        VALUES (new.rowid, new.source_id, new.item_key, new.title, COALESCE(new.summary,''), new.raw_text);
      END;
    `);
    // 既存データの初回バックフィル(fts が空で items が在るときだけ)
    const ftsCount = (this.db.prepare("SELECT COUNT(*) c FROM items_fts").get() as { c: number }).c;
    const itemCount = (this.db.prepare("SELECT COUNT(*) c FROM items").get() as { c: number }).c;
    if (ftsCount === 0 && itemCount > 0) {
      this.db.exec(`
        INSERT INTO items_fts(rowid, source_id, item_key, title, summary, raw_text)
        SELECT rowid, source_id, item_key, title, COALESCE(summary,''), raw_text FROM items;
      `);
    }
  }

  /**
   * 収集 Item を upsert する。dry/本実行に関わらず呼ぶ。
   * - 新規: 挿入 (reported=0, summary=null)
   * - 本文変化: 更新し reported=0, summary=null にリセット (再要約対象)
   * - 変化なし: last_seen_at のみ更新 (reported/summary は維持)
   * reported を消費しないため、dry実行で入れた記事も本実行で取り込まれる。
   * runId は初収集した実行のID(first_seen_run)。実行↔記事の追跡に使う(更新時は変更しない)。
   */
  upsert(item: Item, category: string, sourceName: string, runId: number): UpsertKind {
    const now = new Date().toISOString();
    const existing = this.db
      .prepare("SELECT content_hash FROM items WHERE source_id = ? AND item_key = ?")
      .get(item.sourceId, item.itemKey) as { content_hash: string } | undefined;

    if (!existing) {
      this.db
        .prepare(
          `INSERT INTO items (source_id, item_key, title, url, published_at, content_hash, raw_text, category, source_name, summary, reported, first_seen_run, first_seen_at, last_seen_at)
           VALUES (@sourceId, @itemKey, @title, @url, @publishedAt, @contentHash, @rawText, @category, @sourceName, NULL, 0, @runId, @now, @now)`,
        )
        .run({ ...item, category, sourceName, runId, now });
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

  /** 「現地での注目度」シグナルを保存する(JSON)。 */
  setAttention(sourceId: string, itemKey: string, attention: AttentionMetrics): void {
    this.db
      .prepare("UPDATE items SET attention = ? WHERE source_id = ? AND item_key = ?")
      .run(JSON.stringify(attention), sourceId, itemKey);
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

  /** FTS5(trigram)による全文検索。3文字以上で有効(2文字以下は呼び出し側が searchItems=LIKE を使う)。 */
  searchItemsFts(text: string, limit = 50): StoredItem[] {
    // FTS5 の特殊記号を避けるため二重引用符で囲む(内部の " は "" にエスケープ)。
    const q = `"${text.replace(/"/g, '""')}"`;
    const rows = this.db
      .prepare(
        "SELECT i.* FROM items_fts f JOIN items i ON i.rowid = f.rowid WHERE items_fts MATCH ? ORDER BY rank LIMIT ?",
      )
      .all(q, limit) as ItemRow[];
    return rows.map(rowToStored);
  }

  /** items_fts(全文検索テーブル)が存在するか。未マイグレーションの旧DB判定に使う。 */
  ftsAvailable(): boolean {
    const row = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='items_fts'")
      .get();
    return !!row;
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
