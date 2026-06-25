// 設定メンテナンスCLI。config.json / sources.json を編集する。
//   引数あり = サブコマンド、引数なし = 対話メニュー。
//
//   npm run config -- show
//   npm run config -- get <dotpath>
//   npm run config -- set <dotpath> <value>          例: set runtime.http.llmChatTimeoutMs 600000
//   npm run config -- source list
//   npm run config -- source enable <id> | disable <id> | remove <id>
//   npm run config -- source set <id> <field> <value>
//   npm run config                                    対話メニュー(ソース追加もこちら)
import { createInterface } from "node:readline/promises";
import { join } from "node:path";
import { CHANNELS_DIR, loadRawConfig, saveRawConfig, loadAllSources, saveSources, loadConfig } from "../config.js";
import { channelsOrExit, resolveChannel } from "../channel.js";
import { assembleSource } from "../server/sources.js";
import type { Source } from "../types.js";

// 対象チャンネル(1つ)を解決し、その config/sources を編集対象にする。
const _ids = channelsOrExit();
if (_ids.length !== 1) {
  console.error(`設定編集は1チャンネルを指定してください(--channel=<id>)。対象: ${_ids.join(", ")}`);
  process.exit(1);
}
const channel = resolveChannel(_ids[0]!);
const CONFIG_PATH = join(CHANNELS_DIR, channel.id, "config.json");
const SOURCES_PATH = join(CHANNELS_DIR, channel.id, "sources.json");

// `--channel`(と値)を除いた素の引数。サブコマンド判定/対話判定に使う。
const cliArgs: string[] = (() => {
  const raw = process.argv.slice(2);
  const out: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i]!;
    if (a === "--channel") {
      i++;
      continue;
    }
    if (a.startsWith("--channel=")) continue;
    out.push(a);
  }
  return out;
})();

type Obj = Record<string, unknown>;

function getPath(obj: Obj, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, k) => (acc && typeof acc === "object" ? (acc as Obj)[k] : undefined), obj);
}
function setPath(obj: Obj, path: string, value: unknown): void {
  const keys = path.split(".");
  let cur: Obj = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i]!;
    if (typeof cur[k] !== "object" || cur[k] === null) cur[k] = {};
    cur = cur[k] as Obj;
  }
  cur[keys[keys.length - 1]!] = value;
}
/** 文字列値を number/boolean/null/JSON/string に解釈する。 */
function parseValue(raw: string): unknown {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  if (/^[[{"]/.test(raw)) {
    try {
      return JSON.parse(raw);
    } catch {
      /* fall through */
    }
  }
  return raw;
}

function validateConfig(): void {
  try {
    loadConfig(CONFIG_PATH);
    console.log("✓ config.json は妥当です。");
  } catch (err) {
    console.warn(`⚠ 検証エラー: ${(err as Error).message}`);
  }
}

function setConfigValue(path: string, value: unknown): void {
  const cfg = loadRawConfig(CONFIG_PATH);
  setPath(cfg, path, value);
  saveRawConfig(CONFIG_PATH, cfg);
  console.log(`set ${path} = ${JSON.stringify(value)}`);
  validateConfig();
}

function printSources(): void {
  const sources = loadAllSources(SOURCES_PATH);
  console.log(`=== sources (${sources.length}) ===`);
  for (const s of sources) {
    console.log(`[${s.enabled ? "x" : " "}] ${s.id.padEnd(20)} ${(s.type ?? "auto").padEnd(15)} ${s.name}`);
    console.log(`      ${s.url}`);
  }
}

function updateSource(id: string, mut: (s: Source) => void): void {
  const sources = loadAllSources(SOURCES_PATH);
  const s = sources.find((x) => x.id === id);
  if (!s) {
    console.error(`ソースが見つかりません: ${id}`);
    process.exit(1);
  }
  mut(s);
  saveSources(SOURCES_PATH, sources);
  console.log(`更新: ${id}`);
}

// ---- サブコマンド ----
async function runSubcommand(): Promise<void> {
  const [cmd, ...rest] = cliArgs;
  switch (cmd) {
    case "show": {
      console.log(JSON.stringify(loadRawConfig(CONFIG_PATH), null, 2));
      console.log("");
      printSources();
      break;
    }
    case "get": {
      const path = rest[0];
      if (!path) return usage();
      console.log(JSON.stringify(getPath(loadRawConfig(CONFIG_PATH), path), null, 2));
      break;
    }
    case "set": {
      const [path, ...valParts] = rest;
      if (!path || valParts.length === 0) return usage();
      setConfigValue(path, parseValue(valParts.join(" ")));
      break;
    }
    case "source": {
      const [sub, ...sargs] = rest;
      if (sub === "list") return printSources();
      if (sub === "enable") return void updateSource(sargs[0]!, (s) => (s.enabled = true));
      if (sub === "disable") return void updateSource(sargs[0]!, (s) => (s.enabled = false));
      if (sub === "remove") {
        const id = sargs[0]!;
        const sources = loadAllSources(SOURCES_PATH).filter((s) => s.id !== id);
        saveSources(SOURCES_PATH, sources);
        console.log(`削除: ${id}`);
        return;
      }
      if (sub === "set") {
        const [id, field, ...v] = sargs;
        if (!id || !field || v.length === 0) return usage();
        return void updateSource(id, (s) => {
          (s as unknown as Obj)[field] = parseValue(v.join(" "));
        });
      }
      return usage();
    }
    default:
      return usage();
  }
}

function usage(): void {
  console.log(
    [
      "使い方(--channel=<id> で対象チャンネルを指定):",
      "  npm run config -- --channel=<id> show",
      "  npm run config -- --channel=<id> get <dotpath>",
      "  npm run config -- --channel=<id> set <dotpath> <value>",
      "  npm run config -- --channel=<id> source list|enable <id>|disable <id>|remove <id>",
      "  npm run config -- --channel=<id> source set <id> <field> <value>",
      "  npm run config -- --channel=<id>   (対話メニュー)",
    ].join("\n"),
  );
}

// ---- 対話メニュー ----
async function runInteractive(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string) => rl.question(q);
  try {
    for (;;) {
      console.log(
        "\n=== SignalSeeker 設定メニュー ===\n" +
          "1) 設定を表示\n2) 設定値を変更\n3) ソース一覧\n4) ソースの有効/無効切替\n5) ソース追加\n6) ソース削除\n0) 終了",
      );
      const c = (await ask("選択> ")).trim();
      if (c === "0" || c === "") break;
      if (c === "1") {
        console.log(JSON.stringify(loadRawConfig(CONFIG_PATH), null, 2));
      } else if (c === "2") {
        const path = (await ask("dotpath (例 runtime.http.llmChatTimeoutMs)> ")).trim();
        if (!path) continue;
        console.log(`現在値: ${JSON.stringify(getPath(loadRawConfig(CONFIG_PATH), path))}`);
        const val = (await ask("新しい値> ")).trim();
        if (val) setConfigValue(path, parseValue(val));
      } else if (c === "3") {
        printSources();
      } else if (c === "4") {
        printSources();
        const id = (await ask("切替するソースID> ")).trim();
        if (id) updateSource(id, (s) => (s.enabled = !s.enabled));
      } else if (c === "5") {
        await addSourceInteractive(ask);
      } else if (c === "6") {
        const id = (await ask("削除するソースID> ")).trim();
        if (id) {
          saveSources(SOURCES_PATH, loadAllSources(SOURCES_PATH).filter((s) => s.id !== id));
          console.log(`削除: ${id}`);
        }
      }
    }
  } finally {
    rl.close();
  }
}

async function addSourceInteractive(ask: (q: string) => Promise<string>): Promise<void> {
  const input: Record<string, unknown> = {
    id: (await ask("id> ")).trim(),
    name: (await ask("name> ")).trim(),
    url: (await ask("url> ")).trim(),
    type: (await ask("type (rss/html/github_release) [rss]> ")).trim() || "rss",
    category: (await ask("category> ")).trim() || "未分類",
  };
  if (input.type === "html") {
    const selector = (await ask("selector (html一覧リンク) [a]> ")).trim();
    if (selector) input.selector = selector;
    const maxLinks = (await ask("maxLinks [15]> ")).trim();
    if (maxLinks) input.maxLinks = maxLinks;
  }
  // 検証・組み立ては Web API と共有(src/server/sources.ts)。
  let src: Source;
  try {
    src = assembleSource(input);
  } catch (err) {
    console.warn(`入力が不正です: ${(err as Error).message}。中止しました。`);
    return;
  }
  const sources = loadAllSources(SOURCES_PATH);
  if (sources.some((s) => s.id === src.id)) {
    console.warn(`同じID(${src.id})が既に存在します。中止しました。`);
    return;
  }
  sources.push(src);
  saveSources(SOURCES_PATH, sources);
  console.log(`追加: ${src.id}`);
}

const interactive = cliArgs.length === 0;
(interactive ? runInteractive() : runSubcommand()).catch((err) => {
  console.error("エラー:", (err as Error).message);
  process.exit(1);
});
