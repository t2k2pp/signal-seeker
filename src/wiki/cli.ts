import { loadConfig } from "../config.js";
import { Store } from "../db.js";
import { buildWiki } from "./index.js";

// DB の蓄積から Obsidian vault を再生成する単体コマンド (収集・要約はしない)。
const config = loadConfig();
if (!config.wiki.enabled) {
  console.log("wiki.enabled=false のためスキップしました。");
  process.exit(0);
}
const store = new Store();
try {
  const items = store.allSummarizedItems();
  const { vault, noteCount } = buildWiki(items, config.wiki);
  console.log(`Wiki を再生成しました: ${vault} (${noteCount}件)`);
} finally {
  store.close();
}
