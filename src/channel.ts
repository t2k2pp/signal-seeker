// チャンネル(収集セット)解決の中核。チャンネルIDから「箱(DB/レポート/ログ/Wiki)」・Discord投稿先・
// 要約プロンプトを決定的に導出し、1つのオブジェクトに集約して各処理へ渡す。
// 各チャンネルは config/channels/<id>/{config.json, sources.json} を持つ完全独立構成。
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { CHANNELS_DIR, PROJECT_ROOT, loadConfig, loadSources } from "./config.js";
import { buildSystemPrompt } from "./summarizer/prompt.js";
import type { AppConfig, Source } from "./types.js";

/** チャンネルごとの「箱」(すべて data/<id>/ 配下に固定。config値に依存させず分離を保証)。 */
export interface ChannelPaths {
  dataDir: string;
  db: string;
  reportsDir: string;
  logsDir: string;
  wikiVault: string;
}

/** 解決済みチャンネル。実行に必要な設定・ソース・パス・投稿先・プロンプトを束ねる。 */
export interface ResolvedChannel {
  id: string;
  name: string;
  config: AppConfig;
  sources: Source[];
  paths: ChannelPaths;
  /** Discord webhook URL(notify.discordWebhookEnv の環境変数を解決。未設定なら undefined)。 */
  discordWebhook?: string;
  /** チャンネルの抽出観点から組んだ要約 System プロンプト。 */
  systemPrompt: string;
}

function channelDir(id: string): string {
  return join(CHANNELS_DIR, id);
}

/** config/channels/ 直下の有効なチャンネルID一覧(先頭 _ /. は除外、config.json 必須)。 */
export function listChannels(): string[] {
  if (!existsSync(CHANNELS_DIR)) return [];
  return readdirSync(CHANNELS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("_") && !d.name.startsWith("."))
    .map((d) => d.name)
    .filter((id) => existsSync(join(channelDir(id), "config.json")))
    .sort();
}

function paths(id: string): ChannelPaths {
  const dataDir = join(PROJECT_ROOT, "data", id);
  return {
    dataDir,
    db: join(dataDir, "signalseeker.db"),
    reportsDir: join(dataDir, "reports"),
    logsDir: join(dataDir, "logs"),
    wikiVault: join(dataDir, "wiki"),
  };
}

/** チャンネルを1件解決する。存在しなければ利用可能一覧つきで Error。 */
export function resolveChannel(id: string): ResolvedChannel {
  const dir = channelDir(id);
  const configPath = join(dir, "config.json");
  if (!existsSync(configPath)) {
    const avail = listChannels().join(", ") || "(なし)";
    throw new Error(`チャンネル "${id}" が見つかりません(${configPath})。利用可能: ${avail}`);
  }
  const config = loadConfig(configPath);
  const sources = loadSources(join(dir, "sources.json"));
  const webhookEnv = config.notify.discordWebhookEnv;
  const discordWebhook = webhookEnv ? process.env[webhookEnv] : undefined;
  return {
    id,
    name: config.name ?? id,
    config,
    sources,
    paths: paths(id),
    discordWebhook,
    systemPrompt: buildSystemPrompt(config.extraction),
  };
}

/**
 * `--channel` の値を実行対象IDの配列へ解決する。
 * - "all" → 全チャンネル。
 * - 指定あり → そのID(存在チェック)。
 * - 未指定 → チャンネルが1つだけならそれ、複数あれば明示エラー(黙って既定にしない)。
 */
export function selectChannelIds(arg: string | undefined): string[] {
  const all = listChannels();
  if (all.length === 0) {
    throw new Error("チャンネルがありません。config/channels/<id>/{config.json,sources.json} を用意してください。");
  }
  if (arg === "all") return all;
  if (arg) {
    if (!all.includes(arg)) {
      throw new Error(`チャンネル "${arg}" が見つかりません。利用可能: ${all.join(", ")}`);
    }
    return [arg];
  }
  if (all.length === 1) return all;
  throw new Error(`--channel=<id> を指定してください。利用可能: ${all.join(", ")}(一括は --channel=all)`);
}

/** プロセス引数から `--channel=<id>` / `--channel <id>` を取り出す共通ヘルパ。 */
export function channelArg(argv: string[] = process.argv): string | undefined {
  const eq = argv.find((a) => a.startsWith("--channel="));
  if (eq) return eq.slice("--channel=".length);
  const i = argv.indexOf("--channel");
  return i >= 0 ? argv[i + 1] : undefined;
}

/** `--channel` を解決し、不正・未指定(複数時)ならクリーンなメッセージで終了する(同期CLI用)。 */
export function channelsOrExit(): string[] {
  try {
    return selectChannelIds(channelArg());
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
}
