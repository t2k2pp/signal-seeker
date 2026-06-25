// Web クライアント用の読み取り中心 API。既存資産(Store/buildReportModel/snapshot/config)を
// JSON 化して返す。書き込みは sources.json の軽い操作のみ(DB は触らない=収集と非干渉)。
// 秘密(webhook URL 等)は決してレスポンスに含めない。
import { loadAllSources, loadRawConfig } from "../config.js";
import { listChannels, resolveChannel, type ResolvedChannel } from "../channel.js";
import { SqliteStore } from "../db.js";
import { scoreItem } from "../curation/score.js";
import { listSnapshots, modelFromSnapshot, resolveSnapshot } from "../report/snapshot.js";
import type { StoredItem } from "../types.js";
import { HttpError, Router } from "./router.js";
import {
  applyPatch,
  assembleSource,
  configPath,
  saveSourcesAtomic,
  sourcesPath,
  ValidationError,
} from "./sources.js";

/** チャンネルを解決(存在しなければ 404)。 */
function getChannel(id: string): ResolvedChannel {
  if (!listChannels().includes(id)) throw new HttpError(404, `チャンネル "${id}" が見つかりません`);
  return resolveChannel(id);
}

/** チャンネルDBを読み取り専用で開く(未収集=DB未作成なら 409)。 */
function openStore(ch: ResolvedChannel): SqliteStore {
  try {
    return new SqliteStore(ch.paths.db, { readonly: true });
  } catch {
    throw new HttpError(409, `[${ch.name}] にはまだ収集データがありません(先に crawl を実行してください)`);
  }
}
function withStore<T>(ch: ResolvedChannel, fn: (s: SqliteStore) => T): T {
  const store = openStore(ch);
  try {
    return fn(store);
  } finally {
    store.close();
  }
}

/** 記事に重要度スコアを付与し降順に並べる(レポートと同じ scoreItem を使用)。 */
function scored(items: StoredItem[], ch: ResolvedChannel): (StoredItem & { score: number })[] {
  return items
    .map((it) => ({ ...it, score: scoreItem(it, ch.config.curation) }))
    .sort((a, b) => b.score - a.score);
}

function clampInt(raw: string | null, def: number, min: number, max: number): number {
  const n = raw != null ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

/** config.json を返す前に、平文 apiKey 等の秘密を伏せる(env: 参照は安全なので残す)。 */
function redactConfig(raw: unknown): unknown {
  const clone = JSON.parse(JSON.stringify(raw));
  const walk = (obj: unknown): void => {
    if (!obj || typeof obj !== "object") return;
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (k === "apiKey" && typeof v === "string" && !v.startsWith("env:")) {
        (obj as Record<string, unknown>)[k] = "***";
      } else {
        walk(v);
      }
    }
  };
  walk(clone);
  return clone;
}

export function buildRouter(): Router {
  const router = new Router();

  // 全チャンネル一覧(stats 概要付き。webhook URL は出さず有無のみ)。
  router.get("/api/channels", () => {
    return listChannels().map((id) => {
      const ch = resolveChannel(id);
      let stats: { total: number; summarized: number; pending: number; needingSummary: number } | null = null;
      try {
        const store = new SqliteStore(ch.paths.db, { readonly: true });
        try {
          const s = store.stats();
          stats = { total: s.total, summarized: s.summarized, pending: s.pending, needingSummary: s.needingSummary };
        } finally {
          store.close();
        }
      } catch {
        // 未収集チャンネル(DB 未作成)は stats=null
      }
      return {
        id: ch.id,
        name: ch.name,
        sourcesEnabled: ch.sources.length,
        discordConfigured: !!ch.discordWebhook,
        stats,
      };
    });
  });

  // 横断トリアージ: 全チャンネルの直近記事をスコアリングして上位を返す。
  router.get("/api/triage", (ctx) => {
    const limit = clampInt(ctx.query.get("limit"), 30, 1, 100);
    const all: (StoredItem & { score: number; channelId: string; channelName: string })[] = [];
    for (const id of listChannels()) {
      const ch = resolveChannel(id);
      try {
        const store = new SqliteStore(ch.paths.db, { readonly: true });
        try {
          for (const it of store.listItems({ limit: 100 })) {
            all.push({ ...it, score: scoreItem(it, ch.config.curation), channelId: ch.id, channelName: ch.name });
          }
        } finally {
          store.close();
        }
      } catch {
        // 未収集チャンネルはスキップ
      }
    }
    all.sort((a, b) => b.score - a.score);
    return all.slice(0, limit);
  });

  // 横断全文検索(3文字以上は FTS、2文字以下は LIKE)。
  router.get("/api/search", (ctx) => {
    const q = (ctx.query.get("q") ?? "").trim();
    if (!q) return { query: q, results: [] };
    const limit = clampInt(ctx.query.get("limit"), 50, 1, 200);
    const results: (StoredItem & { channelId: string; channelName: string })[] = [];
    for (const id of listChannels()) {
      const ch = resolveChannel(id);
      try {
        const store = new SqliteStore(ch.paths.db, { readonly: true });
        try {
          const useFts = q.length >= 3 && store.ftsAvailable();
          const hits = useFts ? store.searchItemsFts(q, limit) : store.searchItems(q, limit);
          for (const it of hits) results.push({ ...it, channelId: ch.id, channelName: ch.name });
        } finally {
          store.close();
        }
      } catch {
        // 未収集チャンネルはスキップ
      }
    }
    return { query: q, results };
  });

  router.get("/api/channels/:id/stats", (ctx) => {
    const ch = getChannel(ctx.params.id!);
    return withStore(ch, (s) => s.stats());
  });

  router.get("/api/channels/:id/items", (ctx) => {
    const ch = getChannel(ctx.params.id!);
    const q = (ctx.query.get("q") ?? "").trim();
    const source = ctx.query.get("source") || undefined;
    const filter = ctx.query.get("filter"); // pending | reported
    const limit = clampInt(ctx.query.get("limit"), 50, 1, 500);
    return withStore(ch, (store) => {
      let items: StoredItem[];
      if (q) {
        const useFts = q.length >= 3 && store.ftsAvailable();
        items = useFts ? store.searchItemsFts(q, limit) : store.searchItems(q, limit);
        if (source) items = items.filter((i) => i.sourceId === source);
      } else {
        items = store.listItems({
          sourceId: source,
          pending: filter === "pending",
          reported: filter === "reported",
          limit,
        });
      }
      return scored(items, ch);
    });
  });

  router.get("/api/channels/:id/items/:sourceId/:itemKey", (ctx) => {
    const ch = getChannel(ctx.params.id!);
    return withStore(ch, (store) => {
      const it = store.getItem(ctx.params.sourceId!, ctx.params.itemKey!);
      if (!it) throw new HttpError(404, "記事が見つかりません");
      return { ...it, score: scoreItem(it, ch.config.curation) };
    });
  });

  router.get("/api/channels/:id/runs", (ctx) => {
    const ch = getChannel(ctx.params.id!);
    const limit = clampInt(ctx.query.get("limit"), 20, 1, 200);
    return withStore(ch, (s) => s.recentRuns(limit));
  });

  // スナップショット一覧(本文 summarized は重いので件数だけ返す)。
  router.get("/api/channels/:id/reports", (ctx) => {
    const ch = getChannel(ctx.params.id!);
    return listSnapshots(ch.paths.reportsDir).map((s) => ({
      runLabel: s.runLabel,
      runId: s.runId,
      kind: s.kind ?? "daily",
      date: s.date,
      generatedAt: s.generatedAt,
      counts: s.counts,
      total: s.summarized.length,
      period: s.period ?? null,
    }));
  });

  // 1スナップショットを ReportModel(md/html と同一構造)として返す。
  router.get("/api/channels/:id/reports/:label", (ctx) => {
    const ch = getChannel(ctx.params.id!);
    let snap;
    try {
      snap = resolveSnapshot(ch.paths.reportsDir, { label: ctx.params.label! });
    } catch (err) {
      throw new HttpError(404, (err as Error).message);
    }
    return modelFromSnapshot(snap, ch.config.curation, ch.name);
  });

  // ---- 設定(閲覧) ----
  router.get("/api/channels/:id/sources", (ctx) => {
    const ch = getChannel(ctx.params.id!);
    return loadAllSources(sourcesPath(ch.id));
  });

  router.get("/api/channels/:id/config", (ctx) => {
    const ch = getChannel(ctx.params.id!);
    return redactConfig(loadRawConfig(configPath(ch.id)));
  });

  // ---- 設定(軽い操作: sources.json のみ。DB 非干渉) ----
  router.post("/api/channels/:id/sources", async (ctx) => {
    const ch = getChannel(ctx.params.id!);
    const body = await ctx.readBody<Record<string, unknown>>();
    const path = sourcesPath(ch.id);
    const sources = loadAllSources(path);
    const s = assembleSource(body);
    if (sources.some((x) => x.id === s.id)) {
      throw new ValidationError(`同じID(${s.id})が既に存在します`);
    }
    sources.push(s);
    saveSourcesAtomic(path, sources);
    return s;
  });

  router.patch("/api/channels/:id/sources/:sourceId", async (ctx) => {
    const ch = getChannel(ctx.params.id!);
    const patch = await ctx.readBody<Record<string, unknown>>();
    const path = sourcesPath(ch.id);
    const sources = loadAllSources(path);
    const idx = sources.findIndex((x) => x.id === ctx.params.sourceId);
    if (idx < 0) throw new HttpError(404, `ソース "${ctx.params.sourceId}" が見つかりません`);
    sources[idx] = applyPatch(sources[idx]!, patch);
    saveSourcesAtomic(path, sources);
    return sources[idx];
  });

  router.delete("/api/channels/:id/sources/:sourceId", (ctx) => {
    const ch = getChannel(ctx.params.id!);
    const path = sourcesPath(ch.id);
    const sources = loadAllSources(path);
    const next = sources.filter((x) => x.id !== ctx.params.sourceId);
    if (next.length === sources.length) {
      throw new HttpError(404, `ソース "${ctx.params.sourceId}" が見つかりません`);
    }
    saveSourcesAtomic(path, next);
    return { deleted: ctx.params.sourceId };
  });

  return router;
}
