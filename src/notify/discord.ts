import type { RuntimeConfig } from "../types.js";

const CONTENT_LIMIT = 2000; // Discord メッセージ本文の上限
const ATTACH_LIMIT = 8 * 1024 * 1024; // Webhook 添付の標準上限(8MB)

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

/**
 * Discord Webhook へ送付する。
 * 本文(content)は短い件数サマリのみ。レポート全文は Markdown ファイルとして添付するため、
 * 文字数制限で本文が欠けることがない。content と添付を1リクエスト(multipart)で送る。
 */
export async function notifyDiscord(
  markdown: string,
  fileName: string,
  content: string,
  opts: DiscordOptions,
): Promise<void> {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) {
    console.warn("[discord] DISCORD_WEBHOOK_URL 未設定のためスキップしました。");
    return;
  }

  const bytes = Buffer.byteLength(markdown, "utf-8");
  if (bytes > ATTACH_LIMIT) {
    // 握りつぶさず明示。現実的には起きないが、起きたら添付が拒否されることを警告する。
    console.warn(
      `[discord] レポートが添付上限(${ATTACH_LIMIT}バイト)を超えています(${bytes}バイト)。Discord に拒否される可能性があります。`,
    );
  }

  const makeForm = (): FormData => {
    const form = new FormData();
    form.append("payload_json", JSON.stringify({ content: truncate(content, CONTENT_LIMIT) }));
    form.append("files[0]", new Blob([markdown], { type: "text/markdown" }), fileName);
    return form;
  };

  await post(url, makeForm, opts);
  console.log(`[discord] 件数サマリと ${fileName} を送信しました。`);
}

async function post(url: string, makeForm: () => FormData, opts: DiscordOptions): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    body: makeForm(),
    signal: AbortSignal.timeout(opts.timeoutMs),
  });
  if (res.status === 429) {
    const retry = Number(res.headers.get("retry-after") ?? "1");
    await new Promise((r) => setTimeout(r, retry * opts.retryUnitMs + 250));
    return post(url, makeForm, opts);
  }
  if (!res.ok) {
    throw new Error(`Discord webhook 失敗: HTTP ${res.status} ${await res.text()}`);
  }
}
