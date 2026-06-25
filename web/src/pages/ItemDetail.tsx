import { Link, useParams } from "react-router-dom";
import { api, useAsync } from "../api";
import { AttentionChips, ErrorMsg, Loading, Score, Summary } from "../components";

export default function ItemDetail() {
  const { id = "", sourceId = "", itemKey = "" } = useParams();
  const { data, error, loading } = useAsync(() => api.item(id, sourceId, itemKey), [id, sourceId, itemKey]);

  if (loading) return <Loading />;
  if (error) return <ErrorMsg error={error} />;
  if (!data) return null;

  return (
    <div>
      <div className="row" style={{ marginBottom: 10 }}>
        <Link to={`/c/${id}`}>← {id}</Link>
      </div>
      <h1>{data.title}</h1>
      <div className="meta">
        <Score value={data.score} />
        <AttentionChips a={data.attention} />
        <span className="muted">
          {data.category} / {data.sourceName}
        </span>
        {data.publishedAt && <span className="muted">公開 {data.publishedAt}</span>}
        <span className="muted">初収集 {data.firstSeenAt.slice(0, 10)}</span>
        <span className="pill" style={{ color: data.reported ? "var(--carried)" : "var(--new)" }}>
          {data.reported ? "配信済" : "未配信"}
        </span>
      </div>
      <p>
        <a href={data.url} target="_blank" rel="noopener">
          原文を開く ↗
        </a>
      </p>

      <div className="card">
        <h3>要約</h3>
        <Summary text={data.summary} />
      </div>

      <details className="card" style={{ marginTop: 14 }}>
        <summary>本文(収集テキスト)</summary>
        <pre style={{ whiteSpace: "pre-wrap", fontSize: 13, color: "var(--muted)" }}>{data.rawText ?? "(なし)"}</pre>
      </details>
    </div>
  );
}
