// SignalSeeker ローカル Web サーバ。収集・要約・通知(=書き込み経路)は CLI のまま。
// 本サーバは閲覧中心の読み取り API と、sources.json への軽い操作だけを提供する。
//   npm run serve            … 127.0.0.1:8787 で起動
//   SIGNALSEEKER_PORT=9000 npm run serve / --port=9000 でポート変更
// セキュリティ: 127.0.0.1 のみ bind。秘密(webhook URL 等)は API に出さない。
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { PROJECT_ROOT } from "../config.js";
import { HttpError, readJsonBody, type Ctx } from "./router.js";
import { buildRouter } from "./api.js";
import { ValidationError } from "./sources.js";

const HOST = "127.0.0.1";
function resolvePort(): number {
  const fromArg = process.argv.find((a) => a.startsWith("--port="));
  const raw = fromArg ? fromArg.slice("--port=".length) : process.env.SIGNALSEEKER_PORT;
  const n = raw ? Number(raw) : 8787;
  return Number.isInteger(n) && n > 0 ? n : 8787;
}

const WEB_DIST = join(PROJECT_ROOT, "web", "dist");
const router = buildRouter();

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(json);
}

/** 静的配信(web/dist)。SPA のため未知パスは index.html を返す。 */
function serveStatic(res: ServerResponse, pathname: string): void {
  if (!existsSync(WEB_DIST)) {
    res.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
    res.end("フロントエンド未ビルドです。web/ で `npm install && npm run build` を実行してください。");
    return;
  }
  // パストラバーサル防止: 正規化して dist 配下に限定。
  const rel = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, "");
  let file = join(WEB_DIST, rel);
  if (!file.startsWith(WEB_DIST)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  if (!existsSync(file) || statSync(file).isDirectory()) {
    file = join(WEB_DIST, "index.html"); // SPA フォールバック
  }
  const mime = MIME[extname(file)] ?? "application/octet-stream";
  res.writeHead(200, { "content-type": mime });
  res.end(readFileSync(file));
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${HOST}`);
  const pathname = url.pathname;

  if (!pathname.startsWith("/api/")) {
    serveStatic(res, pathname);
    return;
  }

  const matched = router.match(req.method ?? "GET", pathname);
  if (!matched) {
    sendJson(res, 404, { error: `not found: ${req.method} ${pathname}` });
    return;
  }
  const ctx: Ctx = {
    params: matched.params,
    query: url.searchParams,
    readBody: <T>() => readJsonBody<T>(req),
  };
  try {
    const result = await matched.handler(ctx);
    sendJson(res, 200, result);
  } catch (err) {
    if (err instanceof HttpError) sendJson(res, err.status, { error: err.message });
    else if (err instanceof ValidationError) sendJson(res, 400, { error: err.message });
    else {
      console.error("API エラー:", err);
      sendJson(res, 500, { error: (err as Error).message ?? "internal error" });
    }
  }
}

const port = resolvePort();
createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error("未処理エラー:", err);
    if (!res.headersSent) sendJson(res, 500, { error: "internal error" });
  });
}).listen(port, HOST, () => {
  console.log(`SignalSeeker Web サーバ起動: http://${HOST}:${port}`);
  console.log(existsSync(WEB_DIST) ? "  フロントエンド: web/dist を配信" : "  フロントエンド: 未ビルド(API のみ稼働)");
});
