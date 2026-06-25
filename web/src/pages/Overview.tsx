import { Link } from "react-router-dom";
import { api, useAsync } from "../api";
import { ErrorMsg, Loading } from "../components";

export default function Overview() {
  const channels = useAsync(() => api.channels(), []);
  const triage = useAsync(() => api.triage(25), []);

  return (
    <div>
      <h1>概要</h1>

      <h2>チャンネル</h2>
      {channels.loading && <Loading />}
      {channels.error && <ErrorMsg error={channels.error} />}
      <div className="cards three" style={{ marginBottom: 28 }}>
        {(channels.data ?? []).map((c) => (
          <div className="card" key={c.id}>
            <h3>
              <Link to={`/c/${c.id}`}>{c.name}</Link>
            </h3>
            {c.stats ? (
              <div className="row">
                <span className="pill">総 {c.stats.total}</span>
                <span className="pill">要約 {c.stats.summarized}</span>
                <span className="pill" style={{ color: "var(--new)" }}>
                  未配信 {c.stats.pending}
                </span>
              </div>
            ) : (
              <p className="empty">未収集(crawl 未実行)</p>
            )}
            <div className="muted" style={{ fontSize: 13, marginTop: 8 }}>
              有効ソース {c.sourcesEnabled} ・ Discord {c.discordConfigured ? "設定済" : "未設定"}
            </div>
          </div>
        ))}
      </div>

      <h2>横断トリアージ(重要度上位)</h2>
      {triage.loading && <Loading />}
      {triage.error && <ErrorMsg error={triage.error} />}
      <div className="card">
        {(triage.data ?? []).map((it) => (
          <div key={`${it.channelId}:${it.sourceId}:${it.itemKey}`} className="item">
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
              <span className="score">★{(it.score ?? 0).toFixed(2)}</span>
              <span className="muted">{it.sourceName}</span>
              {it.publishedAt && <span className="muted">{it.publishedAt}</span>}
            </div>
          </div>
        ))}
        {triage.data && triage.data.length === 0 && <p className="empty">対象記事がありません。</p>}
      </div>
    </div>
  );
}
