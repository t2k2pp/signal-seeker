import { useState } from "react";
import { useParams } from "react-router-dom";
import { api, useAsync, type Source } from "../api";
import { ErrorMsg, Loading } from "../components";

const EMPTY = { id: "", name: "", url: "", type: "rss", category: "" };

export default function Settings() {
  const { id = "" } = useParams();
  const sources = useAsync(() => api.sources(id), [id]);
  const config = useAsync(() => api.config(id), [id]);
  const [form, setForm] = useState({ ...EMPTY });
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function act(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg(ok);
      sources.reload();
    } catch (e) {
      setMsg(`エラー: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  const toggle = (s: Source) => act(() => api.patchSource(id, s.id, { enabled: !s.enabled }), `更新: ${s.id}`);
  const remove = (s: Source) => {
    if (confirm(`ソース "${s.id}" を削除しますか?`)) act(() => api.deleteSource(id, s.id), `削除: ${s.id}`);
  };
  const add = (e: React.FormEvent) => {
    e.preventDefault();
    act(async () => {
      await api.addSource(id, form);
      setForm({ ...EMPTY });
    }, `追加: ${form.id}`);
  };

  return (
    <div>
      <h1>{id} — 設定</h1>
      <p className="muted" style={{ fontSize: 13 }}>
        ここでの変更は sources.json に保存され、次回の収集(crawl)から反映されます。
      </p>
      {msg && <p className={msg.startsWith("エラー") ? "err" : "muted"}>{msg}</p>}

      <h2>ソース</h2>
      {sources.loading && <Loading />}
      {sources.error && <ErrorMsg error={sources.error} />}
      <div className="card" style={{ overflowX: "auto" }}>
        <table className="src">
          <thead>
            <tr>
              <th>有効</th>
              <th>id</th>
              <th>name</th>
              <th>type</th>
              <th>category</th>
              <th>url</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(sources.data ?? []).map((s) => (
              <tr key={s.id}>
                <td>
                  <input type="checkbox" className="toggle" checked={s.enabled} disabled={busy} onChange={() => toggle(s)} />
                </td>
                <td>{s.id}</td>
                <td>{s.name}</td>
                <td>{s.type ?? "rss"}</td>
                <td>{s.category}</td>
                <td style={{ maxWidth: 280, wordBreak: "break-all" }}>
                  <a href={s.url} target="_blank" rel="noopener">
                    {s.url}
                  </a>
                </td>
                <td>
                  <button className="danger" disabled={busy} onClick={() => remove(s)}>
                    削除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>ソースを追加</h2>
      <form className="card" onSubmit={add}>
        <div className="row">
          <input placeholder="id" value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value })} required />
          <input placeholder="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            <option value="rss">rss</option>
            <option value="html">html</option>
            <option value="github_release">github_release</option>
          </select>
          <input
            placeholder="category"
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
          />
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <input
            style={{ minWidth: 320 }}
            placeholder="https://… (url)"
            value={form.url}
            onChange={(e) => setForm({ ...form, url: e.target.value })}
            required
          />
          <button type="submit" disabled={busy}>
            追加
          </button>
        </div>
      </form>

      <h2>設定(閲覧)</h2>
      {config.error && <ErrorMsg error={config.error} />}
      <details className="card">
        <summary>config.json(秘密は伏字)</summary>
        <pre style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>{JSON.stringify(config.data, null, 2)}</pre>
      </details>
    </div>
  );
}
