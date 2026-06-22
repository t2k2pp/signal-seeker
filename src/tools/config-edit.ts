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
import { loadRawConfig, saveRawConfig, loadAllSources, saveSources, loadConfig } from "../config.js";
import type { Source, SourceType } from "../types.js";

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
    loadConfig();
    console.log("✓ config.json は妥当です。");
  } catch (err) {
    console.warn(`⚠ 検証エラー: ${(err as Error).message}`);
  }
}

function setConfigValue(path: string, value: unknown): void {
  const cfg = loadRawConfig();
  setPath(cfg, path, value);
  saveRawConfig(cfg);
  console.log(`set ${path} = ${JSON.stringify(value)}`);
  validateConfig();
}

function printSources(): void {
  const sources = loadAllSources();
  console.log(`=== sources (${sources.length}) ===`);
  for (const s of sources) {
    console.log(`[${s.enabled ? "x" : " "}] ${s.id.padEnd(20)} ${(s.type ?? "auto").padEnd(15)} ${s.name}`);
    console.log(`      ${s.url}`);
  }
}

function updateSource(id: string, mut: (s: Source) => void): void {
  const sources = loadAllSources();
  const s = sources.find((x) => x.id === id);
  if (!s) {
    console.error(`ソースが見つかりません: ${id}`);
    process.exit(1);
  }
  mut(s);
  saveSources(sources);
  console.log(`更新: ${id}`);
}

// ---- サブコマンド ----
async function runSubcommand(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case "show": {
      console.log(JSON.stringify(loadRawConfig(), null, 2));
      console.log("");
      printSources();
      break;
    }
    case "get": {
      const path = rest[0];
      if (!path) return usage();
      console.log(JSON.stringify(getPath(loadRawConfig(), path), null, 2));
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
        const sources = loadAllSources().filter((s) => s.id !== id);
        saveSources(sources);
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
      "使い方:",
      "  npm run config -- show",
      "  npm run config -- get <dotpath>",
      "  npm run config -- set <dotpath> <value>",
      "  npm run config -- source list|enable <id>|disable <id>|remove <id>",
      "  npm run config -- source set <id> <field> <value>",
      "  npm run config                 (対話メニュー)",
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
        console.log(JSON.stringify(loadRawConfig(), null, 2));
      } else if (c === "2") {
        const path = (await ask("dotpath (例 runtime.http.llmChatTimeoutMs)> ")).trim();
        if (!path) continue;
        console.log(`現在値: ${JSON.stringify(getPath(loadRawConfig(), path))}`);
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
          saveSources(loadAllSources().filter((s) => s.id !== id));
          console.log(`削除: ${id}`);
        }
      }
    }
  } finally {
    rl.close();
  }
}

async function addSourceInteractive(ask: (q: string) => Promise<string>): Promise<void> {
  const id = (await ask("id> ")).trim();
  const name = (await ask("name> ")).trim();
  const url = (await ask("url> ")).trim();
  const type = ((await ask("type (rss/html/github_release) [rss]> ")).trim() || "rss") as SourceType;
  const category = (await ask("category> ")).trim() || "未分類";
  if (!id || !name || !url) {
    console.warn("id/name/url は必須です。中止しました。");
    return;
  }
  const src: Source = { id, name, url, type, category, enabled: true };
  if (type === "html") {
    const selector = (await ask("selector (html一覧リンク) [a]> ")).trim();
    if (selector) src.selector = selector;
    const maxLinks = (await ask("maxLinks [15]> ")).trim();
    if (maxLinks) src.maxLinks = Number(maxLinks);
  }
  const sources = loadAllSources();
  if (sources.some((s) => s.id === id)) {
    console.warn(`同じID(${id})が既に存在します。中止しました。`);
    return;
  }
  sources.push(src);
  saveSources(sources);
  console.log(`追加: ${id}`);
}

const interactive = process.argv.length <= 2;
(interactive ? runInteractive() : runSubcommand()).catch((err) => {
  console.error("エラー:", (err as Error).message);
  process.exit(1);
});
