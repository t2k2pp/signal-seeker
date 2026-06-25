// 最小のHTTPルータ。method + パスパラメータ(:name)だけを扱う小さな実装。
// フレームワーク依存を増やさず、node:http の上で読みやすいルーティングを提供する。
import type { IncomingMessage } from "node:http";

/** ステータス付きのAPIエラー。ハンドラから throw すると index.ts が対応コードで返す。 */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface Ctx {
  /** パスパラメータ(:id など。decodeURIComponent 済み)。 */
  params: Record<string, string>;
  /** クエリ文字列。 */
  query: URLSearchParams;
  /** リクエストボディを JSON として読む(POST/PATCH 用)。 */
  readBody<T = unknown>(): Promise<T>;
}

export type Handler = (ctx: Ctx) => unknown | Promise<unknown>;

interface Route {
  method: string;
  segments: string[];
  handler: Handler;
}

/** リクエストボディ(JSON)を読む。空ボディは {} を返す。 */
export async function readJsonBody<T = unknown>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString("utf-8").trim();
  if (!raw) return {} as T;
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new HttpError(400, "リクエストボディが不正なJSONです");
  }
}

export class Router {
  private routes: Route[] = [];

  add(method: string, path: string, handler: Handler): void {
    this.routes.push({ method, segments: path.split("/").filter(Boolean), handler });
  }
  get(p: string, h: Handler): void {
    this.add("GET", p, h);
  }
  post(p: string, h: Handler): void {
    this.add("POST", p, h);
  }
  patch(p: string, h: Handler): void {
    this.add("PATCH", p, h);
  }
  delete(p: string, h: Handler): void {
    this.add("DELETE", p, h);
  }

  /** method + pathname に一致するルートを探し、ハンドラとパラメータを返す。 */
  match(method: string, pathname: string): { handler: Handler; params: Record<string, string> } | null {
    const segs = pathname.split("/").filter(Boolean);
    for (const r of this.routes) {
      if (r.method !== method) continue;
      if (r.segments.length !== segs.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < segs.length; i++) {
        const rs = r.segments[i]!;
        if (rs.startsWith(":")) params[rs.slice(1)] = decodeURIComponent(segs[i]!);
        else if (rs !== segs[i]) {
          ok = false;
          break;
        }
      }
      if (ok) return { handler: r.handler, params };
    }
    return null;
  }
}
