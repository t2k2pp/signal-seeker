import type { RuntimeConfig } from "../types.js";

const CONTENT_LIMIT = 2000; // Discord メッセージ本文の上限
const ATTACH_LIMIT = 8 * 1024 * 1024; // Webhook 添付の標準上限(8MB)

export interface DiscordOptions {
  timeoutMs: number;
  retryUnitMs: number;
}

/** Discord に添付する1ファイル(レポート全文 md / インフォグラフィック html 等)。 */
export interface DiscordAttachment {
  /** 添付ファイル名(例 report-<runLabel>.md)。 */
  name: string;
  /** ファイル本体(テキスト)。 */
  data: string;
  /** MIMEタイプ(例 text/markdown, text/html)。 */
  mimeType: string;
}

export function discordOptions(runtime: RuntimeConfig): DiscordOptions {
  return { timeoutMs: runtime.http.discordTimeoutMs, retryUnitMs: runtime.http.discordRetryUnitMs };
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

/**
 * Discord Webhook へ送付する。
 * 本文(content)は短い案内のみ。レポート全文は添付ファイルとして送るため、
 * 文字数制限で本文が欠けることがない。content と添付を1リクエスト(multipart)で送る。
 */
export async function notifyDiscord(
  message: string,
  file: DiscordAttachment,
  opts: DiscordOptions,
  webhookUrl: string | undefined,
): Promise<void> {
  if (!webhookUrl) {
    console.warn("[discord] webhook URL 未設定のためスキップしました(チャンネルの notify.discordWebhookEnv / .env を確認)。");
    return;
  }
  const url = webhookUrl;

  const bytes = Buffer.byteLength(file.data, "utf-8");
  if (bytes > ATTACH_LIMIT) {
    // 握りつぶさず明示。現実的には起きないが、起きたら添付が拒否されることを警告する。
    console.warn(
      `[discord] 添付が上限(${ATTACH_LIMIT}バイト)を超えています(${bytes}バイト)。Discord に拒否される可能性があります。`,
    );
  }

  const makeForm = (): FormData => {
    const form = new FormData();
    form.append("payload_json", JSON.stringify({ content: truncate(message, CONTENT_LIMIT) }));
    form.append("files[0]", new Blob([file.data], { type: file.mimeType }), file.name);
    return form;
  };

  await post(url, makeForm, opts);
  console.log(`[discord] 本文と ${file.name} を送信しました。`);
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
