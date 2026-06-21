import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { PROJECT_ROOT } from "./config.js";
import type { Item } from "./types.js";

const DATA_DIR = join(PROJECT_ROOT, "data");

export type ItemDiff =
  | { kind: "new"; item: Item }
  | { kind: "updated"; item: Item };

/** title+rawText から安定したハッシュを作る。差分判定の基準。 */
export function hashContent(title: string, rawText: string): string {
  return createHash("sha256").update(`${title}\n${rawText}`).digest("hex");
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
        first_seen_at TEXT NOT NULL,
        last_seen_at  TEXT NOT NULL,
        summarized    INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (source_id, item_key)
      );
      CREATE TABLE IF NOT EXISTS runs (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at  TEXT NOT NULL,
        finished_at TEXT,
        new_count   INTEGER NOT NULL DEFAULT 0,
        error       TEXT
      );
    `);
  }

  /** あるソースについて、まだ1件も記録が無い = 初回実行か。 */
  isFirstRunForSource(sourceId: string): boolean {
    const row = this.db
      .prepare("SELECT COUNT(*) AS c FROM items WHERE source_id = ?")
      .get(sourceId) as { c: number };
    return row.c === 0;
  }

  /**
   * 収集 Item 群から差分(新規 or content_hash 変化)を返し、同時に DB を更新する。
   * 既存・未変化の Item は last_seen_at のみ更新。
   */
  reconcile(items: Item[]): ItemDiff[] {
    const now = new Date().toISOString();
    const diffs: ItemDiff[] = [];

    const select = this.db.prepare(
      "SELECT content_hash FROM items WHERE source_id = ? AND item_key = ?",
    );
    const insert = this.db.prepare(`
      INSERT INTO items (source_id, item_key, title, url, published_at, content_hash, raw_text, first_seen_at, last_seen_at)
      VALUES (@sourceId, @itemKey, @title, @url, @publishedAt, @contentHash, @rawText, @now, @now)
    `);
    const update = this.db.prepare(`
      UPDATE items SET title=@title, url=@url, published_at=@publishedAt,
        content_hash=@contentHash, raw_text=@rawText, last_seen_at=@now, summarized=0
      WHERE source_id=@sourceId AND item_key=@itemKey
    `);
    const touch = this.db.prepare(
      "UPDATE items SET last_seen_at = ? WHERE source_id = ? AND item_key = ?",
    );

    const tx = this.db.transaction((rows: Item[]) => {
      for (const item of rows) {
        const existing = select.get(item.sourceId, item.itemKey) as
          | { content_hash: string }
          | undefined;
        const params = { ...item, now };
        if (!existing) {
          insert.run(params);
          diffs.push({ kind: "new", item });
        } else if (existing.content_hash !== item.contentHash) {
          update.run(params);
          diffs.push({ kind: "updated", item });
        } else {
          touch.run(now, item.sourceId, item.itemKey);
        }
      }
    });
    tx(items);
    return diffs;
  }

  /** 要約済みフラグを立てる。 */
  markSummarized(sourceId: string, itemKey: string): void {
    this.db
      .prepare("UPDATE items SET summarized = 1 WHERE source_id = ? AND item_key = ?")
      .run(sourceId, itemKey);
  }

  startRun(): number {
    const info = this.db
      .prepare("INSERT INTO runs (started_at) VALUES (?)")
      .run(new Date().toISOString());
    return Number(info.lastInsertRowid);
  }

  finishRun(runId: number, newCount: number, error?: string): void {
    this.db
      .prepare("UPDATE runs SET finished_at = ?, new_count = ?, error = ? WHERE id = ?")
      .run(new Date().toISOString(), newCount, error ?? null, runId);
  }

  close(): void {
    this.db.close();
  }
}
