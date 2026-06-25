import { useState } from "react";
import { useParams } from "react-router-dom";
import { api, useAsync } from "../api";
import { ErrorMsg, ItemRow, Loading } from "../components";

export default function Channel() {
  const { id = "" } = useParams();
  const [filter, setFilter] = useState("");
  const [source, setSource] = useState("");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");

  // ソース絞り込みは sources.json の id を使う(DB の source_id と一致)。
  const sources = useAsync(() => api.sources(id), [id]);
  const items = useAsync(
    () => api.items(id, { filter: filter || undefined, source: source || undefined, q: query || undefined, limit: 100 }),
    [id, filter, source, query],
  );

  return (
    <div>
      <h1>{id}</h1>

      <form
        className="row"
        style={{ marginBottom: 14 }}
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(q.trim());
        }}
      >
        <input placeholder="このチャンネル内を検索…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="submit">検索</button>
        {query && (
          <button
            type="button"
            className="ghost"
            onClick={() => {
              setQ("");
              setQuery("");
            }}
          >
            クリア
          </button>
        )}
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">すべて</option>
          <option value="pending">未配信のみ</option>
          <option value="reported">配信済のみ</option>
        </select>
        <select value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="">全ソース</option>
          {(sources.data ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </form>

      {items.loading && <Loading />}
      {items.error && <ErrorMsg error={items.error} />}
      <div className="card">
        {(items.data ?? []).map((it) => (
          <ItemRow key={`${it.sourceId}:${it.itemKey}`} item={it} channelId={id} />
        ))}
        {items.data && items.data.length === 0 && <p className="empty">該当する記事がありません。</p>}
      </div>
    </div>
  );
}
