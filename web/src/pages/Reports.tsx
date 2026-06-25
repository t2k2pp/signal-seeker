import { Link, useParams } from "react-router-dom";
import { api, useAsync } from "../api";
import { ErrorMsg, Loading } from "../components";

export default function Reports() {
  const { id = "" } = useParams();
  const reports = useAsync(() => api.reports(id), [id]);
  const runs = useAsync(() => api.runs(id, 15), [id]);

  return (
    <div>
      <h1>{id} — レポート / 履歴</h1>

      <h2>レポート(スナップショット)</h2>
      {reports.loading && <Loading />}
      {reports.error && <ErrorMsg error={reports.error} />}
      <div className="card" style={{ marginBottom: 24 }}>
        {(reports.data ?? []).map((r) => (
          <div key={r.runLabel} className="item">
            <Link className="title" to={`/c/${id}/reports/${encodeURIComponent(r.runLabel)}`}>
              {r.kind === "weekly" ? "🗓 週次" : "🎨 日次"} {r.runLabel}
            </Link>
            <div className="meta">
              <span className="muted">{r.date}</span>
              <span className="pill">{r.total}件</span>
              {r.kind === "daily" && (
                <span className="muted">
                  新規 {r.counts.new} / 更新 {r.counts.updated} / 繰越 {r.counts.carried}
                </span>
              )}
              {r.period && (
                <span className="muted">
                  {r.period.start}〜{r.period.end}({r.period.days}日)
                </span>
              )}
            </div>
          </div>
        ))}
        {reports.data && reports.data.length === 0 && <p className="empty">スナップショットがありません。</p>}
      </div>

      <h2>実行履歴(runs)</h2>
      {runs.loading && <Loading />}
      {runs.error && <ErrorMsg error={runs.error} />}
      <div className="card">
        {(runs.data ?? []).map((r) => (
          <div key={r.id} className="item">
            <div className="row">
              <span className="pill">#{r.id}</span>
              <span
                className="pill"
                style={{
                  color:
                    r.status === "completed"
                      ? "var(--new)"
                      : r.status === "failed"
                        ? "#fca5a5"
                        : "var(--updated)",
                }}
              >
                {r.status}
              </span>
              <span className="muted">{r.dry_run ? "dry" : "real"}</span>
              <span className="muted">新規 {r.new_count}</span>
              <span className="muted">{r.started_at}</span>
            </div>
            {r.error && <div className="err" style={{ marginTop: 6 }}>{r.error}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
