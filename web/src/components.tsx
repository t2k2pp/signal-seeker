// 共通の表示部品(レポート描画と見た目を揃える)。
import { Link } from "react-router-dom";
import type { Attention, Item } from "./api";

export function Loading() {
  return <p className="muted">読み込み中…</p>;
}
export function ErrorMsg({ error }: { error: string }) {
  return <p className="err">エラー: {error}</p>;
}

export function Score({ value }: { value?: number }) {
  if (value == null) return null;
  return <span className="score">★{value.toFixed(2)}</span>;
}

const CHIP_COLORS: Record<string, string> = {
  hf: "#a78bfa",
  cite: "#38bdf8",
  react: "#f472b6",
  star: "#fbbf24",
  pre: "#f87171",
};
function k(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}
export function AttentionChips({ a }: { a?: Attention | null }) {
  if (!a) return null;
  const chips: { t: string; c: string }[] = [];
  if (a.hfUpvotes != null) chips.push({ t: `👍HF ${a.hfUpvotes}`, c: CHIP_COLORS.hf });
  if (a.citationCount != null) chips.push({ t: `引用 ${a.citationCount}`, c: CHIP_COLORS.cite });
  if (a.ghReactions != null) chips.push({ t: `💬 ${a.ghReactions}`, c: CHIP_COLORS.react });
  if (a.ghStars != null) chips.push({ t: `⭐${k(a.ghStars)}`, c: CHIP_COLORS.star });
  if (a.prerelease) chips.push({ t: "⚠prerelease", c: CHIP_COLORS.pre });
  return (
    <>
      {chips.map((c, i) => (
        <span key={i} className="chip" style={{ borderColor: c.c, color: c.c }}>
          {c.t}
        </span>
      ))}
    </>
  );
}

/** 要約の "- " 箇条書きを <ul> に、それ以外を <p> に。 */
export function Summary({ text }: { text: string | null }) {
  if (!text || !text.trim()) {
    return <p className="empty">要約を取得できませんでした(次回実行で再要約します)。</p>;
  }
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const blocks: JSX.Element[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (bullets.length) {
      blocks.push(
        <ul key={blocks.length}>
          {bullets.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>,
      );
      bullets = [];
    }
  };
  for (const line of lines) {
    const m = line.match(/^[-*]\s+(.*)$/);
    if (m) bullets.push(m[1] ?? "");
    else {
      flush();
      blocks.push(<p key={blocks.length}>{line}</p>);
    }
  }
  flush();
  return <div className="summary">{blocks}</div>;
}

/** 記事1件(タイトル・スコア・注目度・要約)。channelId があれば詳細リンクを張る。 */
export function ItemRow({
  item,
  channelId,
  showSummary = true,
}: {
  item: Item;
  channelId: string;
  showSummary?: boolean;
}) {
  const detail = `/c/${channelId}/item/${encodeURIComponent(item.sourceId)}/${encodeURIComponent(item.itemKey)}`;
  return (
    <div className="item">
      <div className="head">
        <Link className="title" to={detail}>
          {item.title}
        </Link>
      </div>
      <div className="meta">
        <Score value={item.score} />
        <AttentionChips a={item.attention} />
        <span className="muted">
          {item.category} / {item.sourceName}
        </span>
        {item.publishedAt && <span className="muted">{item.publishedAt}</span>}
        {!item.reported && <span className="pill" style={{ color: "var(--new)" }}>未配信</span>}
      </div>
      {showSummary && <Summary text={item.summary} />}
      <div className="meta">
        <a href={item.url} target="_blank" rel="noopener">
          原文 ↗
        </a>
      </div>
    </div>
  );
}
