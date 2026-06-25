// 共通の表示部品(レポート描画と見た目を揃える)。
import { Link } from "react-router-dom";
import type { Attention, Item } from "./api";
import { AttentionChips, ScoreBar } from "./viz";

export { AttentionChips };

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

/** 記事1件(タイトル・スコア・注目度・要約)。channelId があれば詳細リンクを張る。
 *  scoreMax を渡すとスコアを相対ゲージ(発光つき)で見せる。 */
export function ItemRow({
  item,
  channelId,
  showSummary = true,
  scoreMax,
}: {
  item: Item;
  channelId: string;
  showSummary?: boolean;
  scoreMax?: number;
}) {
  const detail = `/c/${channelId}/item/${encodeURIComponent(item.sourceId)}/${encodeURIComponent(item.itemKey)}`;
  const hot = scoreMax != null && item.score != null && scoreMax > 0 && item.score / scoreMax >= 0.8;
  return (
    <div className={`item${hot ? " hot" : ""}`}>
      <div className="head">
        <Link className="title" to={detail}>
          {item.title}
        </Link>
        {!item.reported && <span className="new-badge">NEW</span>}
      </div>
      <div className="meta">
        {scoreMax != null ? <ScoreBar value={item.score} max={scoreMax} /> : <Score value={item.score} />}
        <AttentionChips a={item.attention} />
        <span className="muted">
          {item.category} / {item.sourceName}
        </span>
        {item.publishedAt && <span className="muted">{item.publishedAt}</span>}
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
