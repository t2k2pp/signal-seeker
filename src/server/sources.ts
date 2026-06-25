// チャンネルの sources.json を安全に編集するための検証・組み立て・原子的書き込み。
// Web API(src/server/api.ts)と対話CLI(src/tools/config-edit.ts)が同じ検証ロジックを共有する。
import { renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CHANNELS_DIR } from "../config.js";
import type { Source, SourceType } from "../types.js";

const VALID_TYPES: SourceType[] = ["rss", "html", "github_release"];

/** 入力検証に失敗したことを表す(API では 400 にマップする)。 */
export class ValidationError extends Error {}

export function sourcesPath(channelId: string): string {
  return join(CHANNELS_DIR, channelId, "sources.json");
}
export function configPath(channelId: string): string {
  return join(CHANNELS_DIR, channelId, "config.json");
}

/** sources.json を原子的に書き出す(tmp へ書いて rename。途中失敗で壊さない)。 */
export function saveSourcesAtomic(path: string, sources: Source[]): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(sources, null, 2) + "\n", "utf-8");
  renameSync(tmp, path);
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function validateType(v: unknown): SourceType {
  const t = (str(v) || "rss") as SourceType;
  if (!VALID_TYPES.includes(t)) {
    throw new ValidationError(`type は ${VALID_TYPES.join(" / ")} のいずれかを指定してください`);
  }
  return t;
}

function validateUrl(v: unknown): string {
  const url = str(v);
  if (!url) throw new ValidationError("url は必須です");
  if (!/^https?:\/\//i.test(url)) throw new ValidationError("url は http(s):// で始めてください");
  return url;
}

/** 新規追加の入力から Source を組み立てる(必須チェック・既定値)。不正は ValidationError。 */
export function assembleSource(input: Record<string, unknown>): Source {
  const id = str(input.id);
  const name = str(input.name);
  if (!id) throw new ValidationError("id は必須です");
  if (!/^[A-Za-z0-9._-]+$/.test(id)) throw new ValidationError("id は英数字と . _ - のみ使えます");
  if (!name) throw new ValidationError("name は必須です");
  const url = validateUrl(input.url);
  const s: Source = {
    id,
    name,
    url,
    type: validateType(input.type),
    category: str(input.category) || "未分類",
    enabled: input.enabled !== false,
  };
  if (str(input.feedUrl)) s.feedUrl = str(input.feedUrl);
  if (str(input.selector)) s.selector = str(input.selector);
  if (input.maxLinks != null && input.maxLinks !== "") {
    const n = Number(input.maxLinks);
    if (!Number.isInteger(n) || n <= 0) throw new ValidationError("maxLinks は正の整数で指定してください");
    s.maxLinks = n;
  }
  return s;
}

/** 既存 Source に部分更新を適用した新しい Source を返す(id は変更不可)。不正は ValidationError。 */
export function applyPatch(s: Source, patch: Record<string, unknown>): Source {
  const next: Source = { ...s };
  if ("enabled" in patch) next.enabled = patch.enabled !== false;
  if ("name" in patch) {
    const name = str(patch.name);
    if (!name) throw new ValidationError("name は空にできません");
    next.name = name;
  }
  if ("url" in patch) next.url = validateUrl(patch.url);
  if ("category" in patch) next.category = str(patch.category) || "未分類";
  if ("type" in patch) next.type = validateType(patch.type);
  if ("feedUrl" in patch) next.feedUrl = str(patch.feedUrl) || undefined;
  if ("selector" in patch) next.selector = str(patch.selector) || undefined;
  if ("maxLinks" in patch) {
    if (patch.maxLinks == null || patch.maxLinks === "") next.maxLinks = undefined;
    else {
      const n = Number(patch.maxLinks);
      if (!Number.isInteger(n) || n <= 0) throw new ValidationError("maxLinks は正の整数で指定してください");
      next.maxLinks = n;
    }
  }
  return next;
}
