import { Link, useParams } from "react-router-dom";
import { api, useAsync, type SourceBlock } from "../api";
import { AttentionChips, ErrorMsg, Loading, Score, Summary } from "../components";

function SourceCard({ sb }: { sb: SourceBlock }) {
  return (
    <div className="card">
      <h3>
        {sb.sourceName} <span className="muted">({sb.count})</span>
      </h3>
      {sb.groups.map((g, i) => (
        <div key={i} className="item">
          <a className="title" href={g.primary.url} target="_blank" rel="noopener">
            {g.primary.title}
          </a>
          <div className="meta">
            <Score value={g.primary.score} />
            <AttentionChips a={g.primary.attention} />
            {g.primary.publishedAt && <span className="muted">{g.primary.publishedAt}</span>}
          </div>
          <Summary text={g.primary.summary} />
          {g.others.length > 0 && (
            <details>
              <summary>同系列の関連 {g.others.length}件</summary>
              <ul>
                {g.others.map((o, j) => (
                  <li key={j}>
                    <a href={o.url} target="_blank" rel="noopener">
                      {o.title}
                    </a>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      ))}
      {sb.noFacts.length > 0 && (
        <details>
          <summary>参考(ファクト抽出なし) {sb.noFacts.length}件</summary>
          <ul>
            {sb.noFacts.map((n, i) => (
              <li key={i}>
                <a href={n.url} target="_blank" rel="noopener">
                  {n.title}
                </a>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export default function ReportView() {
  const { id = "", label = "" } = useParams();
  const { data: m, error, loading } = useAsync(() => api.report(id, label), [id, label]);

  if (loading) return <Loading />;
  if (error) return <ErrorMsg error={error} />;
  if (!m) return null;

  const title =
    m.kind === "weekly" && m.period
      ? `週次 ${m.period.start} 〜 ${m.period.end}(${m.period.days}日間)`
      : `日次 ${m.date}${m.runId != null ? ` (run #${m.runId})` : ""}`;

  return (
    <div>
      <div className="row" style={{ marginBottom: 10 }}>
        <Link to={`/c/${id}/reports`}>← レポート一覧</Link>
      </div>
      <h1>
        {m.channelName ? `[${m.channelName}] ` : ""}
        {title}
      </h1>
      <div className="row" style={{ marginBottom: 18 }}>
        <span className="pill">{m.total}件</span>
        {m.kind === "daily" && (
          <span className="muted">
            新規 {m.counts.new} / 更新 {m.counts.updated} / 繰越 {m.counts.carried}
          </span>
        )}
      </div>

      {m.total === 0 && <p className="empty">対象記事はありませんでした。</p>}
      {m.catBlocks.map((cb) => (
        <section key={cb.category} style={{ marginBottom: 26 }}>
          <h2>
            {cb.category} <span className="muted">{cb.count}件</span>
          </h2>
          <div className="cards two">
            {cb.sources.map((sb) => (
              <SourceCard key={sb.sourceName} sb={sb} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
