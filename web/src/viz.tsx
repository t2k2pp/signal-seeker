// 「魅せる」ための小さな可視化部品。外部ライブラリは使わず純 SVG + CSS で作る
// (バックエンドを node:http だけで組んだプロジェクトの軽量方針に合わせる)。
import { useEffect, useRef, useState } from "react";
import type { Attention } from "./api";

// 注目度メトリクスの「満タン」基準(対数目盛り。種類ごとに桁が違うため別基準)。
const ATTN: Record<string, { label: (v: number) => string; color: string; cap: number }> = {
  hfUpvotes: { label: (v) => `👍HF ${v}`, color: "#a78bfa", cap: 500 },
  citationCount: { label: (v) => `引用 ${v}`, color: "#38bdf8", cap: 1000 },
  ghReactions: { label: (v) => `💬 ${v}`, color: "#f472b6", cap: 500 },
  ghStars: { label: (v) => `⭐${v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v}`, color: "#fbbf24", cap: 100000 },
};

/** 注目度を「満たし具合の見えるミニ棒」で見せる(数字の大小が視覚で伝わる)。 */
export function AttentionChips({ a }: { a?: Attention | null }) {
  if (!a) return null;
  const bars: { fill: number; label: string; color: string }[] = [];
  for (const [key, def] of Object.entries(ATTN)) {
    const v = (a as Record<string, number | undefined>)[key];
    if (v == null) continue;
    const fill = Math.max(0.06, Math.min(1, Math.log10(v + 1) / Math.log10(def.cap)));
    bars.push({ fill, label: def.label(v), color: def.color });
  }
  return (
    <>
      {bars.map((b, i) => (
        <span
          key={i}
          className="attn"
          style={{
            borderColor: b.color,
            color: b.color,
            background: `linear-gradient(90deg, ${b.color}33 ${(b.fill * 100).toFixed(0)}%, transparent ${(b.fill * 100).toFixed(0)}%)`,
          }}
        >
          {b.label}
        </span>
      ))}
      {a.prerelease && (
        <span className="attn" style={{ borderColor: "#f87171", color: "#f87171" }}>
          ⚠prerelease
        </span>
      )}
    </>
  );
}

/** 0 から目標値まで一気に駆け上がるカウントアップ数値。 */
export function CountUp({ value, duration = 800 }: { value: number; duration?: number }) {
  const [n, setN] = useState(0);
  const ref = useRef<number>(0);
  useEffect(() => {
    const from = ref.current;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      const cur = Math.round(from + (value - from) * eased);
      setN(cur);
      if (t < 1) raf = requestAnimationFrame(tick);
      else ref.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <>{n.toLocaleString()}</>;
}

/** 収集ごとの新着件数を細い折れ線で描く(動いている感を出す)。 */
export function Sparkline({ data, color = "var(--accent)" }: { data: number[]; color?: string }) {
  const w = 96;
  const h = 26;
  const pad = 2;
  if (!data.length) return <span className="muted" style={{ fontSize: 11 }}>履歴なし</span>;
  if (data.length === 1) {
    return (
      <svg className="spark" width={w} height={h} aria-hidden>
        <circle cx={w / 2} cy={h / 2} r={2.5} fill={color} />
      </svg>
    );
  }
  const max = Math.max(1, ...data);
  const step = (w - pad * 2) / (data.length - 1);
  const pts = data.map((v, i) => {
    const x = pad + i * step;
    const y = h - pad - (v / max) * (h - pad * 2);
    return [x, y] as const;
  });
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${pad},${h - pad} ${line} ${(w - pad).toFixed(1)},${h - pad}`;
  const [lx, ly] = pts[pts.length - 1]!;
  return (
    <svg className="spark" width={w} height={h} aria-hidden>
      <polygon points={area} fill={color} opacity={0.12} />
      <polyline points={line} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lx} cy={ly} r={2.4} fill={color} />
    </svg>
  );
}

/** スコアを横ゲージで見せる。上位(max に近い)は発光させる。 */
export function ScoreBar({ value, max, width = 110 }: { value?: number; max: number; width?: number }) {
  if (value == null) return null;
  const ratio = max > 0 ? Math.max(0.04, Math.min(1, value / max)) : 0;
  const hot = ratio >= 0.8;
  return (
    <span className={`scorebar${hot ? " hot" : ""}`} style={{ width }} title={`スコア ${value.toFixed(2)}`}>
      <span className="scorebar-fill" style={{ width: `${(ratio * 100).toFixed(0)}%` }} />
      <span className="scorebar-val">★{value.toFixed(2)}</span>
    </span>
  );
}

/** 順位バッジ。上位3件は金銀銅。 */
export function Rank({ n }: { n: number }) {
  const medal = n === 1 ? "gold" : n === 2 ? "silver" : n === 3 ? "bronze" : "";
  const label = n === 1 ? "🥇" : n === 2 ? "🥈" : n === 3 ? "🥉" : `${n}`;
  return <span className={`rank ${medal}`}>{label}</span>;
}

/** ISO 時刻を「3時間前」のような相対表現にする(素朴・日本語)。 */
export function relTime(iso: string | null): string {
  if (!iso) return "不明";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "不明";
  const sec = Math.max(0, (Date.now() - t) / 1000);
  if (sec < 60) return "たった今";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}分前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}時間前`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}日前`;
  return `${Math.floor(day / 30)}か月前`;
}

/** 最終収集の鼓動インジケータ(緑=正常 / 赤=失敗)。 */
export function LiveDot({ status }: { status?: string }) {
  const ok = status === "completed" || status === "running" || status == null;
  return <span className={`live-dot${ok ? "" : " err"}`} aria-hidden />;
}
