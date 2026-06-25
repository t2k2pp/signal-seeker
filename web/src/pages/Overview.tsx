import { Link } from "react-router-dom";
import { api, useAsync, type TriageItem } from "../api";
import { AttentionChips, ErrorMsg, Loading, Summary } from "../components";
import { CountUp, LiveDot, Rank, ScoreBar, Sparkline, relTime } from "../viz";

export default function Overview() {
  const channels = useAsync(() => api.channels(), []);
  const triage = useAsync(() => api.triage(25), []);

  const list = channels.data ?? [];
  const withStats = list.filter((c) => c.stats);
  const totals = withStats.reduce(
    (acc, c) => ({
      total: acc.total + (c.stats?.total ?? 0),
      summarized: acc.summarized + (c.stats?.summarized ?? 0),
      pending: acc.pending + (c.stats?.pending ?? 0),
    }),
    { total: 0, summarized: 0, pending: 0 },
  );

  const items = triage.data ?? [];
  const hero = items[0];
  const rest = items.slice(1);
  const scoreMax = items.reduce((m, it) => Math.max(m, it.score ?? 0), 0);

  return (
    <div>
      <h1>概要</h1>

      {/* A: 全体サマリを大きく動かす */}
      <div className="metrics">
        <Metric value={totals.total} label="総シグナル" />
        <Metric value={totals.summarized} label="要約済み" />
        <Metric value={totals.pending} label="未配信" accent="var(--new)" />
        <Metric value={withStats.length} label="稼働チャンネル" sub={`/ ${list.length}`} />
      </div>

      <h2>チャンネル</h2>
      {channels.loading && <Loading />}
      {channels.error && <ErrorMsg error={channels.error} />}
      <div className="cards three" style={{ marginBottom: 28 }}>
        {list.map((c) => (
          <div className="card chan" key={c.id}>
            <h3>
              <Link to={`/c/${c.id}`}>{c.name}</Link>
            </h3>
            {c.stats ? (
              <>
                <div className="chan-live">
                  <LiveDot status={c.lastRun?.status} />
                  <span className="muted">最終収集 {relTime(c.lastRun?.at ?? null)}</span>
                  {c.lastRun && c.lastRun.newCount > 0 && (
                    <span className="new-badge sm">+{c.lastRun.newCount}</span>
                  )}
                </div>
                <div className="row" style={{ margin: "8px 0" }}>
                  <span className="pill">総 {c.stats.total}</span>
                  <span className="pill">要約 {c.stats.summarized}</span>
                  <span className="pill" style={{ color: "var(--new)" }}>
                    未配信 {c.stats.pending}
                  </span>
                </div>
                <Sparkline data={c.activity} />
              </>
            ) : (
              <p className="empty">未収集(crawl 未実行)</p>
            )}
            <div className="muted" style={{ fontSize: 13, marginTop: 8 }}>
              有効ソース {c.sourcesEnabled} ・ Discord {c.discordConfigured ? "設定済" : "未設定"}
            </div>
          </div>
        ))}
      </div>

      {/* B: 横断トリアージをランキング+ヒーローで魅せる */}
      <h2>今日の最重要シグナル</h2>
      {triage.loading && <Loading />}
      {triage.error && <ErrorMsg error={triage.error} />}

      {hero && <HeroItem item={hero} />}

      <div className="card" style={{ marginTop: 14 }}>
        {rest.map((it, i) => (
          <div key={`${it.channelId}:${it.sourceId}:${it.itemKey}`} className="rankrow">
            <Rank n={i + 2} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="head">
                <span className="pill" style={{ fontSize: 11 }}>
                  {it.channelName}
                </span>
                <Link
                  className="title"
                  to={`/c/${it.channelId}/item/${encodeURIComponent(it.sourceId)}/${encodeURIComponent(it.itemKey)}`}
                >
                  {it.title}
                </Link>
              </div>
              <div className="meta">
                <ScoreBar value={it.score} max={scoreMax} />
                <AttentionChips a={it.attention} />
                <span className="muted">{it.sourceName}</span>
                {it.publishedAt && <span className="muted">{it.publishedAt}</span>}
              </div>
            </div>
          </div>
        ))}
        {triage.data && items.length === 0 && <p className="empty">対象記事がありません。</p>}
      </div>
    </div>
  );
}

function Metric({
  value,
  label,
  sub,
  accent,
}: {
  value: number;
  label: string;
  sub?: string;
  accent?: string;
}) {
  return (
    <div className="metric">
      <div className="metric-num" style={accent ? { color: accent } : undefined}>
        <CountUp value={value} />
        {sub && <span className="metric-sub">{sub}</span>}
      </div>
      <div className="metric-label">{label}</div>
    </div>
  );
}

function HeroItem({ item }: { item: TriageItem }) {
  const detail = `/c/${item.channelId}/item/${encodeURIComponent(item.sourceId)}/${encodeURIComponent(item.itemKey)}`;
  return (
    <div className="hero">
      <div className="hero-rank">🥇</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="hero-tags">
          <span className="pill">{item.channelName}</span>
          {!item.reported && <span className="new-badge">NEW</span>}
          <span className="muted" style={{ fontSize: 12 }}>
            {item.category} / {item.sourceName}
          </span>
        </div>
        <Link className="hero-title" to={detail}>
          {item.title}
        </Link>
        <div className="meta" style={{ marginTop: 6 }}>
          <ScoreBar value={item.score} max={item.score ?? 1} width={140} />
          <AttentionChips a={item.attention} />
        </div>
        <div className="hero-summary">
          <Summary text={item.summary} />
        </div>
        <a href={item.url} target="_blank" rel="noopener" style={{ fontSize: 13 }}>
          原文 ↗
        </a>
      </div>
    </div>
  );
}
