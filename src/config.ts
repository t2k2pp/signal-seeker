import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import dotenv from "dotenv";
import type { AppConfig, Source } from "./types.js";

dotenv.config();

const here = dirname(fileURLToPath(import.meta.url));
/** プロジェクトルート (src/ の1つ上)。config/ と data/ の基準。 */
export const PROJECT_ROOT = join(here, "..");

function readJson<T>(relPath: string): T {
  const full = join(PROJECT_ROOT, relPath);
  try {
    return JSON.parse(readFileSync(full, "utf-8")) as T;
  } catch (err) {
    throw new Error(`設定ファイルの読み込みに失敗: ${relPath} — ${(err as Error).message}`);
  }
}

export function loadConfig(): AppConfig {
  const cfg = readJson<AppConfig>("config/config.json");
  if (!cfg.llm?.endpoint?.providerType || !cfg.llm.endpoint.model) {
    throw new Error("config.json: llm.endpoint.providerType と model は必須です");
  }
  if (!Array.isArray(cfg.notify?.targets)) {
    throw new Error("config.json: notify.targets は配列で指定してください");
  }
  cfg.firstRunLimit ??= 5;

  // collect の既定
  cfg.collect = {
    maxContentChars: cfg.collect?.maxContentChars ?? 8000,
    fetchArticleBody: cfg.collect?.fetchArticleBody ?? true,
  };

  // wiki の既定
  cfg.wiki = {
    enabled: cfg.wiki?.enabled ?? true,
    vaultPath: cfg.wiki?.vaultPath ?? "data/wiki",
    defaultTags: cfg.wiki?.defaultTags ?? ["signalseeker"],
  };

  return cfg;
}

export function loadSources(): Source[] {
  const sources = readJson<Source[]>("config/sources.json");
  if (!Array.isArray(sources)) {
    throw new Error("sources.json はソース配列で指定してください");
  }
  return sources.filter((s) => s.enabled);
}
