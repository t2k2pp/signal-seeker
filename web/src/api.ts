// API クライアント。バックエンド(src/server)の JSON をそのまま型付けして扱う。
import { useEffect, useState } from "react";

export interface ChannelSummary {
  id: string;
  name: string;
  sourcesEnabled: number;
  discordConfigured: boolean;
  stats: { total: number; summarized: number; pending: number; needingSummary: number } | null;
}

export interface Attention {
  hfUpvotes?: number;
  citationCount?: number;
  ghStars?: number;
  ghReactions?: number;
  prerelease?: boolean;
}

export interface Item {
  sourceId: string;
  itemKey: string;
  title: string;
  url: string;
  publishedAt: string | null;
  category: string;
  sourceName: string;
  summary: string | null;
  /** 収集した本文(詳細取得時のみ。一覧では省略されることがある)。 */
  rawText?: string;
  reported: boolean;
  attention?: Attention | null;
  firstSeenAt: string;
  lastSeenAt: string;
  score?: number;
}

export interface TriageItem extends Item {
  channelId: string;
  channelName: string;
}

export interface SearchResult extends Item {
  channelId: string;
  channelName: string;
}

export interface Stats {
  total: number;
  summarized: number;
  pending: number;
  needingSummary: number;
  byCategory: { category: string; count: number }[];
  bySource: { sourceName: string; count: number }[];
}

export interface RunRow {
  id: number;
  started_at: string;
  finished_at: string | null;
  dry_run: number;
  status: string;
  new_count: number;
  log_label: string | null;
  error: string | null;
}

export interface ReportListEntry {
  runLabel: string;
  runId: number | null;
  kind: "daily" | "weekly";
  date: string;
  generatedAt: string;
  counts: { new: number; updated: number; carried: number };
  total: number;
  period: { start: string; end: string; days: number } | null;
}

export interface Source {
  id: string;
  name: string;
  url: string;
  type?: string;
  category: string;
  feedUrl?: string;
  selector?: string;
  maxLinks?: number;
  enabled: boolean;
}

// ReportModel(src/report/model.ts と同形)。描画に必要な範囲だけ。
export interface NoFactLink {
  title: string;
  url: string;
  publishedAt: string | null;
}
export interface SeriesGroup {
  primary: Item;
  others: Item[];
}
export interface SourceBlock {
  sourceName: string;
  count: number;
  groups: SeriesGroup[];
  noFacts: NoFactLink[];
}
export interface CatBlock {
  category: string;
  count: number;
  sources: SourceBlock[];
}
export interface ReportModel {
  kind: "daily" | "weekly";
  channelName: string | null;
  date: string;
  period: { start: string; end: string; days: number } | null;
  runId: number | null;
  total: number;
  counts: { new: number; updated: number; carried: number };
  rankByScore: boolean;
  catBlocks: CatBlock[];
}

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let msg = res.statusText;
    try {
      msg = (await res.json()).error ?? msg;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

export const api = {
  channels: () => jsonFetch<ChannelSummary[]>("/api/channels"),
  triage: (limit = 30) => jsonFetch<TriageItem[]>(`/api/triage?limit=${limit}`),
  search: (q: string, limit = 50) =>
    jsonFetch<{ query: string; results: SearchResult[] }>(`/api/search?q=${encodeURIComponent(q)}&limit=${limit}`),
  stats: (id: string) => jsonFetch<Stats>(`/api/channels/${id}/stats`),
  items: (id: string, params: { source?: string; filter?: string; q?: string; limit?: number }) => {
    const u = new URLSearchParams();
    if (params.source) u.set("source", params.source);
    if (params.filter) u.set("filter", params.filter);
    if (params.q) u.set("q", params.q);
    if (params.limit) u.set("limit", String(params.limit));
    return jsonFetch<Item[]>(`/api/channels/${id}/items?${u.toString()}`);
  },
  item: (id: string, sourceId: string, itemKey: string) =>
    jsonFetch<Item>(`/api/channels/${id}/items/${encodeURIComponent(sourceId)}/${encodeURIComponent(itemKey)}`),
  runs: (id: string, limit = 20) => jsonFetch<RunRow[]>(`/api/channels/${id}/runs?limit=${limit}`),
  reports: (id: string) => jsonFetch<ReportListEntry[]>(`/api/channels/${id}/reports`),
  report: (id: string, label: string) =>
    jsonFetch<ReportModel>(`/api/channels/${id}/reports/${encodeURIComponent(label)}`),
  sources: (id: string) => jsonFetch<Source[]>(`/api/channels/${id}/sources`),
  config: (id: string) => jsonFetch<Record<string, unknown>>(`/api/channels/${id}/config`),
  patchSource: (id: string, sourceId: string, patch: Partial<Source>) =>
    jsonFetch<Source>(`/api/channels/${id}/sources/${encodeURIComponent(sourceId)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    }),
  addSource: (id: string, src: Partial<Source>) =>
    jsonFetch<Source>(`/api/channels/${id}/sources`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(src),
    }),
  deleteSource: (id: string, sourceId: string) =>
    jsonFetch<{ deleted: string }>(`/api/channels/${id}/sources/${encodeURIComponent(sourceId)}`, {
      method: "DELETE",
    }),
};

/** データ読み込み用の最小フック。deps 変化で再取得。 */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fn()
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError((e as Error).message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data, error, loading, reload: () => setTick((t) => t + 1) };
}
