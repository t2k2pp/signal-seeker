import type { RuntimeConfig, SummarizedItem } from "../types.js";

const EMBED_DESC_LIMIT = 4000; // Discord embed description は最大4096
const EMBEDS_PER_MESSAGE = 10; // 1メッセージあたり最大10 embed

export interface DiscordOptions {
  timeoutMs: number;
  retryUnitMs: number;
}

export function discordOptions(runtime: RuntimeConfig): DiscordOptions {
  return { timeoutMs: runtime.http.discordTimeoutMs, retryUnitMs: runtime.http.discordRetryUnitMs };
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

function toEmbed(item: SummarizedItem): Record<string, unknown> {
  const badge = item.state === "new" ? "🆕 " : item.state === "updated" ? "♻️ " : "📥 ";
  return {
    title: truncate(`${badge}${item.title}`, 256),
    url: item.url,
    description: truncate(item.summary?.trim() || "(要約なし)", EMBED_DESC_LIMIT),
    color: item.state === "new" ? 0x2ecc71 : item.state === "updated" ? 0xf1c40f : 0x95a5a6,
    footer: { text: `${item.category} / ${item.sourceName}` },
    ...(item.publishedAt ? { timestamp: new Date(item.publishedAt).toISOString() } : {}),
  };
}

/** Discord Webhook へ embed 形式で送付する。10件ずつ分割して送る。 */
export async function notifyDiscord(items: SummarizedItem[], opts: DiscordOptions): Promise<void> {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) {
    console.warn("[discord] DISCORD_WEBHOOK_URL 未設定のためスキップしました。");
    return;
  }
  if (items.length === 0) {
    await post(url, { content: "SignalSeeker: 今回の新規・更新はありませんでした。" }, opts);
    return;
  }

  for (let i = 0; i < items.length; i += EMBEDS_PER_MESSAGE) {
    const batch = items.slice(i, i + EMBEDS_PER_MESSAGE).map(toEmbed);
    await post(url, { embeds: batch }, opts);
  }
  console.log(`[discord] ${items.length}件を送信しました。`);
}

async function post(url: string, body: Record<string, unknown>, opts: DiscordOptions): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(opts.timeoutMs),
  });
  if (res.status === 429) {
    const retry = Number(res.headers.get("retry-after") ?? "1");
    await new Promise((r) => setTimeout(r, retry * opts.retryUnitMs + 250));
    return post(url, body, opts);
  }
  if (!res.ok) {
    throw new Error(`Discord webhook 失敗: HTTP ${res.status} ${await res.text()}`);
  }
}
