// DB の要約済み記事から Obsidian 互換の Markdown vault を生成する。
// lllmAgents の Obsidian 連携(frontmatter + 階層タグ + ソースURL)に倣う。
// グループ化は MOC(Map of Content) と階層タグで行い、検索は Obsidian 標準に委ねる(AIは要約のみ)。
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { isAbsolute, join } from "node:path";
import { PROJECT_ROOT } from "../config.js";
import type { StoredItem, WikiConfig } from "../types.js";

/** Obsidian 非対応文字を除去し slug 化。 */
function slugify(s: string): string {
  return (
    s
      .replace(/[\\/:*?"<>|#^[\]]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "untitled"
  );
}

function hash8(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 8);
}

function esc(s: string): string {
  return s.replace(/"/g, '\\"');
}

/** vaultPath を絶対パスへ解決(相対ならプロジェクトルート基準)。 */
function resolveVault(vaultPath: string): string {
  return isAbsolute(vaultPath) ? vaultPath : join(PROJECT_ROOT, vaultPath);
}

interface NoteRef {
  basename: string;
  title: string;
  sourceName: string;
  category: string;
  url: string;
  publishedAt: string | null;
}

function buildNote(item: StoredItem, defaultTags: string[], mocBasename: string): string {
  const tags = [
    ...new Set([
      ...defaultTags,
      `category/${slugify(item.category)}`,
      `source/${slugify(item.sourceName)}`,
    ]),
  ];
  const fm = [
    "---",
    `title: "${esc(item.title)}"`,
    `source: "${esc(item.url)}"`,
    `url: "${esc(item.url)}"`,
    `site: "${esc(item.sourceName)}"`,
    `category: "${esc(item.category)}"`,
    "tags:",
    ...tags.map((t) => `  - ${t}`),
    `published: ${item.publishedAt ?? ""}`,
    `collected: ${item.firstSeenAt}`,
    `updated: ${item.lastSeenAt}`,
    "---",
    "",
  ];
  const body = [
    `# ${item.title}`,
    "",
    `> 出典(エビデンス): [${item.sourceName}](${item.url})${item.publishedAt ? `  ·  ${item.publishedAt}` : ""}`,
    "",
    "## 要約(客観ファクト)",
    "",
    item.summary?.trim() || "_要約なし_",
    "",
    "## 取得本文(抜粋)",
    "",
    item.rawText.trim() ? item.rawText.trim() : "_本文なし_",
    "",
    "---",
    `カテゴリ: [[${mocBasename}|${item.category}]]`,
    "",
  ];
  return fm.join("\n") + body.join("\n");
}

/**
 * DB の要約済み記事すべてから vault を再生成する(冪等)。
 * 管理対象は <vault>/Notes・<vault>/MOC・<vault>/index.md のみ。
 */
export function buildWiki(items: StoredItem[], cfg: WikiConfig): { vault: string; noteCount: number } {
  const vault = resolveVault(cfg.vaultPath);
  const notesDir = join(vault, "Notes");
  const mocDir = join(vault, "MOC");
  const defaultTags = cfg.defaultTags ?? ["signalseeker"];

  // 管理ディレクトリのみクリア(ユーザの他ノートには触れない)
  for (const d of [notesDir, mocDir]) {
    if (existsSync(d)) rmSync(d, { recursive: true, force: true });
    mkdirSync(d, { recursive: true });
  }

  // カテゴリ -> ソース -> NoteRef
  const byCategory = new Map<string, Map<string, NoteRef[]>>();

  for (const item of items) {
    const mocBasename = `MOC ${item.category}`;
    const basename = `${slugify(item.title)}-${hash8(item.url)}`;
    writeFileSync(join(notesDir, `${basename}.md`), buildNote(item, defaultTags, mocBasename), "utf-8");

    const cat = byCategory.get(item.category) ?? new Map<string, NoteRef[]>();
    const arr = cat.get(item.sourceName) ?? [];
    arr.push({
      basename,
      title: item.title,
      sourceName: item.sourceName,
      category: item.category,
      url: item.url,
      publishedAt: item.publishedAt,
    });
    cat.set(item.sourceName, arr);
    byCategory.set(item.category, cat);
  }

  // カテゴリMOC
  for (const [category, sources] of byCategory) {
    const lines = [
      "---",
      `title: "${esc(category)} MOC"`,
      "tags:",
      ...[...new Set([...defaultTags, "moc"])].map((t) => `  - ${t}`),
      "---",
      "",
      `# ${category}`,
      "",
    ];
    for (const [sourceName, notes] of sources) {
      lines.push(`## ${sourceName}`, "");
      for (const n of notes) {
        lines.push(`- [[${n.basename}|${n.title}]]${n.publishedAt ? `  ·  ${n.publishedAt}` : ""}`);
      }
      lines.push("");
    }
    writeFileSync(join(mocDir, `MOC ${category}.md`), lines.join("\n"), "utf-8");
  }

  // ルート index
  const idx = [
    "---",
    'title: "SignalSeeker Wiki"',
    "tags:",
    ...[...new Set([...defaultTags, "moc"])].map((t) => `  - ${t}`),
    "---",
    "",
    "# SignalSeeker Wiki",
    "",
    `最終更新: ${new Date().toISOString()}  ·  記事数: ${items.length}`,
    "",
    "## カテゴリ",
    "",
  ];
  for (const [category, sources] of byCategory) {
    const count = [...sources.values()].reduce((a, n) => a + n.length, 0);
    idx.push(`- [[MOC ${category}|${category}]] (${count}件)`);
  }
  idx.push("");
  writeFileSync(join(vault, "index.md"), idx.join("\n"), "utf-8");

  return { vault, noteCount: items.length };
}
