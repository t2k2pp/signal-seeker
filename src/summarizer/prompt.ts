import type { ExtractionConfig } from "../types.js";

/** 全チャンネル共通の「ファクト無し」固定句(curation 側の判定とも揃える)。 */
export const DEFAULT_NO_FACTS = "- 抽出すべきファクトなし";

/**
 * チャンネル(ジャンル)別の抽出観点から System プロンプトを組み立てる。
 * 役割(role)と観点(viewpoints)だけ差し替え、日本語出力・客観性ルールは共通。
 */
export function buildSystemPrompt(ex: ExtractionConfig): string {
  const viewpoints = ex.viewpoints.map((v, i) => `${i + 1}. ${v}`).join("\n");
  const noFacts = ex.noFacts ?? DEFAULT_NO_FACTS;
  return `あなたは${ex.role}です。
与えられた記事から、感情的な表現・誇張・煽りを完全に排除し、以下の観点について
客観的なファクトのみを日本語の箇条書き(各行 "- " 始まり)で抽出してください。

${viewpoints}

出力言語のルール:
- 出力は必ず日本語で書くこと。原文が英語でも、説明文・本文は日本語に翻訳して記述する。
- ただし次のものは翻訳せず原文のまま残すこと: 固有名詞、製品名・サービス名・銘柄名・企業名、
  正式名称・規格名、コードやコマンド・識別子、数値・通貨・単位・バージョン番号。
- 英単語をカタカナに無理に置き換えず、上記に当たる語はそのまま表記する。

各観点に該当する事実が無ければその観点は省略してよい。
記事から確実に読み取れる事実のみを記載し、推測・意見・宣伝文句は含めないこと。
該当するファクトが一切無い場合は「${noFacts}」とだけ出力すること。`;
}
