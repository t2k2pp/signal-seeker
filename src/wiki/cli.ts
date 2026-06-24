import { SqliteStore } from "../db.js";
import { channelsOrExit, resolveChannel, type ResolvedChannel } from "../channel.js";
import { buildWiki } from "./index.js";

// DB の蓄積から Obsidian vault を再生成する単体コマンド (収集・要約はしない)。
//   npm run wiki -- [--channel=<id>|all]
function runWiki(channel: ResolvedChannel): void {
  if (!channel.config.wiki.enabled) {
    console.log(`[${channel.name}] wiki.enabled=false のためスキップしました。`);
    return;
  }
  const store = new SqliteStore(channel.paths.db);
  try {
    const items = store.allSummarizedItems();
    const { vault, noteCount } = buildWiki(
      items,
      { ...channel.config.wiki, vaultPath: channel.paths.wikiVault },
      channel.config.curation,
    );
    console.log(`[${channel.name}] Wiki を再生成しました: ${vault} (${noteCount}件)`);
  } finally {
    store.close();
  }
}

for (const id of channelsOrExit()) {
  runWiki(resolveChannel(id));
}
