import { NavLink, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { api, useAsync } from "./api";
import Overview from "./pages/Overview";
import Channel from "./pages/Channel";
import ItemDetail from "./pages/ItemDetail";
import Reports from "./pages/Reports";
import ReportView from "./pages/ReportView";
import Search from "./pages/Search";
import Settings from "./pages/Settings";

function ChannelSwitcher() {
  const { id } = useParams();
  const nav = useNavigate();
  const { data } = useAsync(() => api.channels(), []);
  return (
    <select
      value={id ?? ""}
      onChange={(e) => e.target.value && nav(`/c/${e.target.value}`)}
      aria-label="チャンネル選択"
    >
      <option value="">チャンネル切替…</option>
      {(data ?? []).map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  );
}

function ChannelTabs() {
  const { id } = useParams();
  if (!id) return null;
  return (
    <div className="row" style={{ marginBottom: 16 }}>
      <NavLink end to={`/c/${id}`}>
        記事
      </NavLink>
      <NavLink to={`/c/${id}/reports`}>レポート</NavLink>
      <NavLink to={`/c/${id}/settings`}>設定</NavLink>
    </div>
  );
}

export default function App() {
  return (
    <>
      <nav className="nav">
        <div className="nav-inner">
          <span className="brand">
            <span className="dot" />
            SignalSeeker
          </span>
          <NavLink end to="/">
            概要
          </NavLink>
          <NavLink to="/search">検索</NavLink>
          <span className="spacer" />
          <ChannelSwitcher />
        </div>
      </nav>
      <div className="wrap">
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/search" element={<Search />} />
          <Route
            path="/c/:id"
            element={
              <>
                <ChannelTabs />
                <Channel />
              </>
            }
          />
          <Route
            path="/c/:id/reports"
            element={
              <>
                <ChannelTabs />
                <Reports />
              </>
            }
          />
          <Route path="/c/:id/reports/:label" element={<ReportView />} />
          <Route
            path="/c/:id/settings"
            element={
              <>
                <ChannelTabs />
                <Settings />
              </>
            }
          />
          <Route path="/c/:id/item/:sourceId/:itemKey" element={<ItemDetail />} />
          <Route path="*" element={<p className="muted">ページが見つかりません。</p>} />
        </Routes>
      </div>
    </>
  );
}
