// 「現地での注目度」シグナルを外部APIから収集する。
//  - arXiv論文 : Hugging Face Papers の upvote(認証不要) / Semantic Scholar の引用数(任意キー)
//  - GitHubリリース : リポジトリ star 数・リリースへの reaction 合計・prerelease 判定(無認証可)
// 取得できないシグナルは undefined のまま(=スコアに寄与しない)。失敗は記事単位で握り全体は止めない。
import type { AttentionMetrics, CurationConfig, Item, Source } from "../types.js";
import type { Logger } from "../logger.js";

export interface AttentionResult {
  sourceId: string;
  itemKey: string;
  attention: AttentionMetrics;
}

/** arXiv の URL/ID から版番号を除いた論文ID(例 2606.20560v1 → 2606.20560)。 */
function extractArxivId(url: string): string | null {
  const m = url.match(/(\d{4}\.\d{4,5})(v\d+)?/);
  return m && m[1] ? m[1] : null;
}

/** GitHub リリースURLから owner/repo/tag を取り出す。 */
function parseGithubRelease(url: string): { owner: string; repo: string; tag: string } | null {
  const m = url.match(/github\.com\/([^/]+)\/([^/]+)\/releases\/tag\/([^/?#]+)/);
  if (!m || !m[1] || !m[2] || !m[3]) return null;
  return { owner: m[1], repo: m[2], tag: decodeURIComponent(m[3]) };
}

async function fetchJson(
  url: string,
  timeoutMs: number,
  headers: Record<string, string> = {},
): Promise<{ status: number; data: unknown }> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* 非JSONレスポンスは data=null */
  }
  return { status: res.status, data };
}

interface RepoInfo {
  stars?: number;
  /** tag → { prerelease, reactions } */
  releases: Map<string, { prerelease: boolean; reactions: number }>;
}

/** GitHub の star 数とリリース一覧を1リポジトリにつき1回だけ取得してキャッシュする。 */
async function loadRepoInfo(
  owner: string,
  repo: string,
  timeoutMs: number,
  ghHeaders: Record<string, string>,
  logger: Logger,
): Promise<RepoInfo> {
  const info: RepoInfo = { releases: new Map() };
  try {
    const r = await fetchJson(`https://api.github.com/repos/${owner}/${repo}`, timeoutMs, ghHeaders);
    if (r.status === 200) info.stars = (r.data as { stargazers_count?: number }).stargazers_count;
    else logger.warn("attention_github_repo_http", { owner, repo, status: r.status });
  } catch (err) {
    logger.warn("attention_github_repo_error", { owner, repo, message: (err as Error).message });
  }
  try {
    const r = await fetchJson(
      `https://api.github.com/repos/${owner}/${repo}/releases?per_page=100`,
      timeoutMs,
      ghHeaders,
    );
    if (r.status === 200 && Array.isArray(r.data)) {
      for (const rel of r.data as { tag_name?: string; prerelease?: boolean; reactions?: { total_count?: number } }[]) {
        if (rel.tag_name) {
          info.releases.set(rel.tag_name, {
            prerelease: rel.prerelease ?? false,
            reactions: rel.reactions?.total_count ?? 0,
          });
        }
      }
    } else {
      logger.warn("attention_github_releases_http", { owner, repo, status: r.status });
    }
  } catch (err) {
    logger.warn("attention_github_releases_error", { owner, repo, message: (err as Error).message });
  }
  return info;
}

/**
 * 収集 Item 群に「現地での注目度」を付与する。source.type で取得先を分岐。
 * GitHub のリポジトリ単位呼び出しはキャッシュして1リポジトリ1回に抑える。
 */
export async function enrichAttention(
  items: Item[],
  sources: Source[],
  cfg: CurationConfig,
  logger: Logger,
): Promise<AttentionResult[]> {
  if (!cfg.enrichAttention) return [];
  const typeById = new Map(sources.map((s) => [s.id, s.type]));
  const results: AttentionResult[] = [];

  const ghHeaders: Record<string, string> = { "User-Agent": "signalseeker" };
  if (process.env.GITHUB_TOKEN) ghHeaders.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const s2Headers: Record<string, string> = {};
  if (process.env.S2_API_KEY) s2Headers["x-api-key"] = process.env.S2_API_KEY;

  const repoCache = new Map<string, RepoInfo>();
  const t = cfg.fetchTimeoutMs;

  for (const item of items) {
    const type = typeById.get(item.sourceId);
    const att: AttentionMetrics = { fetchedAt: new Date().toISOString() };

    if (type === "github_release" && cfg.sources.github) {
      const g = parseGithubRelease(item.url);
      if (g) {
        const key = `${g.owner}/${g.repo}`;
        let repoInfo = repoCache.get(key);
        if (!repoInfo) {
          repoInfo = await loadRepoInfo(g.owner, g.repo, t, ghHeaders, logger);
          repoCache.set(key, repoInfo);
        }
        att.ghStars = repoInfo.stars;
        const rel = repoInfo.releases.get(g.tag);
        if (rel) {
          att.ghReactions = rel.reactions;
          att.prerelease = rel.prerelease;
        } else if (/rc\d|alpha|beta|-pre/i.test(g.tag)) {
          att.prerelease = true; // 一覧に無くてもタグ名から推定
        }
      }
    }

    // arXiv 論文(rss型だがURLで判定。HF と S2 を試す)
    const arxivId = extractArxivId(item.url);
    if (arxivId && item.url.includes("arxiv.org")) {
      if (cfg.sources.hfPapers) {
        try {
          const r = await fetchJson(`https://huggingface.co/api/papers/${arxivId}`, t);
          if (r.status === 200) att.hfUpvotes = (r.data as { upvotes?: number }).upvotes ?? 0;
          // 404 = HF上にページ無し(注目度シグナル無し)。正常としてスキップ。
        } catch (err) {
          logger.warn("attention_hf_error", { arxivId, message: (err as Error).message });
        }
      }
      if (cfg.sources.semanticScholar) {
        try {
          const r = await fetchJson(
            `https://api.semanticscholar.org/graph/v1/paper/arXiv:${arxivId}?fields=citationCount`,
            t,
            s2Headers,
          );
          if (r.status === 200) att.citationCount = (r.data as { citationCount?: number }).citationCount ?? 0;
          else if (r.status === 429) logger.warn("attention_s2_rate_limited", { arxivId });
        } catch (err) {
          logger.warn("attention_s2_error", { arxivId, message: (err as Error).message });
        }
      }
    }

    results.push({ sourceId: item.sourceId, itemKey: item.itemKey, attention: att });
  }

  logger.info("attention_enriched", {
    items: results.length,
    repos: repoCache.size,
    githubToken: !!process.env.GITHUB_TOKEN,
    s2Key: !!process.env.S2_API_KEY,
  });
  return results;
}
