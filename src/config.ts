import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import dotenv from "dotenv";
import type { AppConfig, Source } from "./types.js";

dotenv.config();

const here = dirname(fileURLToPath(import.meta.url));
/** プロジェクトルート (src/ の1つ上)。config/ と data/ の基準。 */
export const PROJECT_ROOT = join(here, "..");

export const CONFIG_PATH = join(PROJECT_ROOT, "config", "config.json");
export const SOURCES_PATH = join(PROJECT_ROOT, "config", "sources.json");

function readJson<T>(full: string, label: string): T {
  try {
    return JSON.parse(readFileSync(full, "utf-8")) as T;
  } catch (err) {
    throw new Error(`設定ファイルの読み込みに失敗: ${label} — ${(err as Error).message}`);
  }
}

/** 既定値を適用した実行用設定を返す。 */
export function loadConfig(): AppConfig {
  const cfg = readJson<AppConfig>(CONFIG_PATH, "config/config.json");
  if (!cfg.llm?.endpoint?.providerType || !cfg.llm.endpoint.model) {
    throw new Error("config.json: llm.endpoint.providerType と model は必須です");
  }
  if (!Array.isArray(cfg.notify?.targets)) {
    throw new Error("config.json: notify.targets は配列で指定してください");
  }
  cfg.firstRunLimit ??= 5;

  cfg.collect = {
    maxContentChars: cfg.collect?.maxContentChars ?? 8000,
    fetchArticleBody: cfg.collect?.fetchArticleBody ?? true,
    articleBodyMinChars: cfg.collect?.articleBodyMinChars ?? 400,
  };

  const cu = cfg.curation ?? ({} as AppConfig["curation"]);
  cfg.curation = {
    rankByScore: cu.rankByScore ?? true,
    groupReleaseSeries: cu.groupReleaseSeries ?? true,
    enrichAttention: cu.enrichAttention ?? true,
    sources: {
      hfPapers: cu.sources?.hfPapers ?? true,
      semanticScholar: cu.sources?.semanticScholar ?? true,
      github: cu.sources?.github ?? true,
    },
    fetchTimeoutMs: cu.fetchTimeoutMs ?? 15000,
    weights: {
      recency: cu.weights?.recency ?? 0.4,
      attention: cu.weights?.attention ?? 0.4,
      content: cu.weights?.content ?? 0.2,
    },
    recencyHalfLifeDays: cu.recencyHalfLifeDays ?? 7,
    demoteFactor: cu.demoteFactor ?? 0.3,
  };

  cfg.wiki = {
    enabled: cfg.wiki?.enabled ?? true,
    vaultPath: cfg.wiki?.vaultPath ?? "data/wiki",
    defaultTags: cfg.wiki?.defaultTags ?? ["signalseeker"],
  };

  const r = cfg.runtime ?? ({} as AppConfig["runtime"]);
  cfg.runtime = {
    http: {
      llmChatTimeoutMs: r.http?.llmChatTimeoutMs ?? 600000,
      llmTestTimeoutMs: r.http?.llmTestTimeoutMs ?? 8000,
      rssTimeoutMs: r.http?.rssTimeoutMs ?? 20000,
      discordTimeoutMs: r.http?.discordTimeoutMs ?? 15000,
      discordRetryUnitMs: r.http?.discordRetryUnitMs ?? 1000,
    },
    playwright: {
      navTimeoutMs: r.playwright?.navTimeoutMs ?? 30000,
      articleTimeoutMs: r.playwright?.articleTimeoutMs ?? 25000,
    },
    summarize: {
      maxOutputTokens: r.summarize?.maxOutputTokens ?? 8000,
      maxRetries: r.summarize?.maxRetries ?? 2,
      retryBackoffMs: r.summarize?.retryBackoffMs ?? 3000,
    },
    logging: {
      dir: r.logging?.dir ?? "data/logs",
      level: r.logging?.level ?? "info",
      maxIoChars: r.logging?.maxIoChars ?? 0,
    },
  };

  return cfg;
}

/** 既定値を適用せず、ファイルそのままの内容を返す(設定編集ツール用)。 */
export function loadRawConfig(): Record<string, unknown> {
  return readJson<Record<string, unknown>>(CONFIG_PATH, "config/config.json");
}

export function saveRawConfig(obj: unknown): void {
  writeFileSync(CONFIG_PATH, JSON.stringify(obj, null, 2) + "\n", "utf-8");
}

export function loadSources(): Source[] {
  const sources = readJson<Source[]>(SOURCES_PATH, "config/sources.json");
  if (!Array.isArray(sources)) {
    throw new Error("sources.json はソース配列で指定してください");
  }
  return sources.filter((s) => s.enabled);
}

/** enabled に関わらず全ソースを返す(設定編集ツール用)。 */
export function loadAllSources(): Source[] {
  return readJson<Source[]>(SOURCES_PATH, "config/sources.json");
}

export function saveSources(sources: Source[]): void {
  writeFileSync(SOURCES_PATH, JSON.stringify(sources, null, 2) + "\n", "utf-8");
}
