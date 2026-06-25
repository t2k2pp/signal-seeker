import { useState } from "react";
import { Link } from "react-router-dom";
import { api, useAsync, type SearchResult } from "../api";
import { ErrorMsg, Loading, Score } from "../components";

export default function Search() {
  const [input, setInput] = useState("");
  const [q, setQ] = useState("");
  const { data, error, loading } = useAsync(
    () => (q ? api.search(q, 80) : Promise.resolve({ query: "", results: [] as SearchResult[] })),
    [q],
  );

  // チャンネル別にグループ化。
  const groups = new Map<string, SearchResult[]>();
  for (const r of data?.results ?? []) {
    const arr = groups.get(r.channelName) ?? [];
    arr.push(r);
    groups.set(r.channelName, arr);
  }

  return (
    <div>
      <h1>横断検索</h1>
      <form
        className="row search-box"
        style={{ marginBottom: 16 }}
        onSubmit={(e) => {
          e.preventDefault();
          setQ(input.trim());
        }}
      >
        <input
          style={{ minWidth: 280 }}
          placeholder="全チャンネルを検索(3文字以上で全文検索)…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <button type="submit">検索</button>
      </form>

      {loading && q && <Loading />}
      {error && <ErrorMsg error={error} />}
      {q && data && data.results.length === 0 && !loading && <p className="empty">「{q}」に一致なし。</p>}

      {[...groups.entries()].map(([channelName, items]) => (
        <section key={channelName} style={{ marginBottom: 22 }}>
          <h2>
            {channelName} <span className="muted">{items.length}件</span>
          </h2>
          <div className="card">
            {items.map((it) => (
              <div key={`${it.channelId}:${it.sourceId}:${it.itemKey}`} className="item">
                <Link
                  className="title"
                  to={`/c/${it.channelId}/item/${encodeURIComponent(it.sourceId)}/${encodeURIComponent(it.itemKey)}`}
                >
                  {it.title}
                </Link>
                <div className="meta">
                  <Score value={it.score} />
                  <span className="muted">
                    {it.category} / {it.sourceName}
                  </span>
                  {it.publishedAt && <span className="muted">{it.publishedAt}</span>}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
