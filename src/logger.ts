import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { PROJECT_ROOT } from "./config.js";
import type { LogLevel, RuntimeConfig } from "./types.js";
import type { Message } from "./llm/base-provider.js";

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function ts(): string {
  return new Date().toISOString();
}

/** 不具合解析用の構造化ログ。JSONL 実行ログ + コンソール + LLM IO 全文ファイル。 */
export class Logger {
  /** 実行を識別するラベル(ファイル名やイベント突合に使用)。 */
  readonly runLabel: string;
  private dir: string;
  private llmDir: string;
  private runLogPath: string;
  private minLevel: number;
  private maxIoChars: number;

  constructor(logging: RuntimeConfig["logging"]) {
    this.runLabel = ts().replace(/[:.]/g, "-");
    this.dir = isAbsolute(logging.dir) ? logging.dir : join(PROJECT_ROOT, logging.dir);
    this.llmDir = join(this.dir, "llm");
    this.minLevel = LEVELS[logging.level] ?? LEVELS.info;
    this.maxIoChars = logging.maxIoChars ?? 0;
    mkdirSync(this.llmDir, { recursive: true });
    this.runLogPath = join(this.dir, `run-${this.runLabel}.jsonl`);
  }

  private write(level: LogLevel, event: string, fields?: Record<string, unknown>): void {
    const entry = { ts: ts(), level, event, ...(fields ?? {}) };
    try {
      appendFileSync(this.runLogPath, JSON.stringify(entry) + "\n", "utf-8");
    } catch {
      /* ログ書き込み失敗は本処理を止めない */
    }
    if (LEVELS[level] >= this.minLevel) {
      const line = `[${level}] ${event}${fields ? " " + compact(fields) : ""}`;
      if (level === "error") console.error(line);
      else if (level === "warn") console.warn(line);
      else console.log(line);
    }
  }

  debug(event: string, fields?: Record<string, unknown>): void {
    this.write("debug", event, fields);
  }
  info(event: string, fields?: Record<string, unknown>): void {
    this.write("info", event, fields);
  }
  warn(event: string, fields?: Record<string, unknown>): void {
    this.write("warn", event, fields);
  }
  error(event: string, fields?: Record<string, unknown>): void {
    this.write("error", event, fields);
  }

  private cap(s: string): string {
    if (this.maxIoChars > 0 && s.length > this.maxIoChars) {
      return s.slice(0, this.maxIoChars) + `\n…[truncated ${s.length - this.maxIoChars} chars]`;
    }
    return s;
  }

  /** LLM 1呼び出しの input/output/usage/ms/error を全文ファイルに保存し、要約を実行ログへ。 */
  logLlmCall(params: {
    n: number;
    providerType: string;
    model: string;
    system?: string;
    messages: Message[];
    output: string | null;
    usage?: { promptTokens?: number; completionTokens?: number };
    ms: number;
    error?: string;
    context?: Record<string, unknown>;
  }): string {
    const file = join(this.llmDir, `${this.runLabel}-${String(params.n).padStart(4, "0")}.json`);
    const record = {
      runLabel: this.runLabel,
      n: params.n,
      ts: ts(),
      providerType: params.providerType,
      model: params.model,
      ms: params.ms,
      usage: params.usage ?? null,
      error: params.error ?? null,
      context: params.context ?? null,
      input: {
        system: params.system ? this.cap(params.system) : null,
        messages: params.messages.map((m) => ({ role: m.role, content: this.cap(m.content) })),
      },
      output: params.output != null ? this.cap(params.output) : null,
    };
    try {
      writeFileSync(file, JSON.stringify(record, null, 2), "utf-8");
    } catch {
      /* ignore */
    }
    this.write(params.error ? "warn" : "info", "llm_call", {
      n: params.n,
      model: params.model,
      ms: params.ms,
      usage: params.usage,
      error: params.error,
      file,
      ...(params.context ?? {}),
    });
    return file;
  }

  /** 実行ログのパスを返す(起動時の案内用)。 */
  get path(): string {
    return this.runLogPath;
  }
}

function compact(fields: Record<string, unknown>): string {
  try {
    return JSON.stringify(fields);
  } catch {
    return String(fields);
  }
}
