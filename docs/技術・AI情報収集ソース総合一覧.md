# **技術・AI情報収集ソース総合一覧（2026年6月版）**

自動収集ツール（RSS、Webスクレイパー等）およびLLMによるファクト抽出・要約パイプラインの入力元として統合した、網羅的な情報ソースリストです。

## **1\. 生成AI 基盤技術・組織公式発信（一次情報）**

各ベンダーの公式な技術動向、新モデルの発表、アーキテクチャの解説。

* **Google / DeepMind**  
  * Google DeepMind Blog: https://deepmind.google/discover/blog/  
  * Google Cloud AI & Machine Learning Blog: https://cloud.google.com/blog/products/ai-machine-learning  
  * Google AI for Developers Blog: https://developers.googleblog.com/search/label/AI  
  * 公式 API Changelog: https://ai.google.dev/gemini-api/docs/changelog  
* **Anthropic**  
  * Anthropic News: https://www.anthropic.com/news  
  * Anthropic Research: https://www.anthropic.com/research  
  * 公式 Release Notes: https://docs.anthropic.com/en/release-notes/overview  
* **OpenAI**  
  * OpenAI Blog: https://openai.com/blog  
  * OpenAI Research: https://openai.com/research  
  * 公式 API Changelog: https://platform.openai.com/docs/changelog  
* **Meta AI (FAIR)**  
  * Meta AI Blog: https://ai.meta.com/blog/  
* **その他有力ベンダー・プラットフォーム**  
  * Hugging Face Blog: https://huggingface.co/blog  
  * Mistral AI News: https://mistral.ai/news/  
  * Cohere Blog: https://txt.cohere.com/  
  * NVIDIA Technical Blog (AI): https://developer.nvidia.com/blog/category/artificial-intelligence/

## **2\. キーパーソン・オピニオンリーダー（シグナル・先行情報）**

※主にX(旧Twitter)等のSNSフィードを想定。LLMによるノイズ除去とファクト抽出が必須。

* **Google**: Demis Hassabis, Jeff Dean  
* **Anthropic**: Dario Amodei, Jack Clark, Jared Kaplan, Boris Power  
* **OpenAI**: Sam Altman, Greg Brockman, Mira Murati  
* **研究・コミュニティ**: Yann LeCun, Andrej Karpathy, Andrew Ng, Jim Fan

## **3\. 論文・学術研究（最深部ファクト）**

* **arXiv**  
  * cs.AI (Artificial Intelligence)  
  * cs.CL (Computation and Language)  
  * cs.LG (Machine Learning)  
* **論文アグリゲーター**  
  * Hugging Face Daily Papers: https://huggingface.co/papers  
  * Papers with Code: https://paperswithcode.com/  
  * AK (@\_akhaliq) のフィード

## **4\. エコシステム・OSS動向（実装レイヤー）**

* **オーケストレーション・エージェント**  
  * LangChain Blog / Releases: https://blog.langchain.dev/ , GitHub Releases  
  * LlamaIndex Blog / Releases: https://www.llamaindex.ai/blog , GitHub Releases  
  * MCP (Model Context Protocol) 関連リポジトリ  
* **ローカル推論・インフラ**  
  * vLLM (GitHub Releases)  
  * llama.cpp (GitHub Releases)  
  * Ollama (Blog / GitHub Releases): https://ollama.com/blog

## **5\. アグリゲーター・ニュースレター（トレンド認知）**

* **コミュニティ主導**  
  * Hacker News: https://news.ycombinator.com/  
  * GitHub Trending: https://github.com/trending  
* **AI特化ニュースレター**  
  * Import AI: https://importai.substack.com/  
  * AlphaSignal: https://alphasignal.ai/  
  * The Rundown AI: https://www.therundown.ai/  
  * TLDR AI / TLDR Web Dev: https://tldr.tech/  
  * Ahead of AI: https://magazine.sebastianraschka.com/

## **6\. 実務・アーキテクチャ・運用事例（上位レイヤー）**

* **テックジャイアントのエンジニアリングブログ**  
  * Cloudflare Blog: https://blog.cloudflare.com/  
  * Netflix TechBlog: https://netflixtechblog.com/  
  * Uber Engineering Blog: https://www.uber.com/en-JP/blog/engineering/  
  * Meta Engineering: https://engineering.fb.com/  
* **クラウドベンダーのアーキテクチャセンター**  
  * AWS Architecture Center: https://aws.amazon.com/jp/architecture/  
  * Google Cloud Architecture Center: https://cloud.google.com/architecture  
  * Azure Architecture Center: https://learn.microsoft.com/ja-jp/azure/architecture/  
* **国内エンタープライズ事例**  
  * Publickey: https://www.publickey1.jp/  
  * Zenn 企業テックブログ (要スクリーニング): https://zenn.dev/enterprises

## **7\. Web標準・プロトコル・セキュリティ（不変的基盤）**

* **標準仕様**  
  * IETF / RFC: https://datatracker.ietf.org/  
  * W3C / TC39: https://www.w3.org/TR/  
* **セキュリティ・インシデント**  
  * NVD (National Vulnerability Database): https://nvd.nist.gov/  
  * 各社 大規模障害のPostmortem (事後報告書)

### **（参考）自動収集・抽出パイプラインの想定アーキテクチャ**

1. **Collector**: n8n, Dify 等のツールで上記ソースから定期的にテキスト（タイトル、本文、リリースノート）を取得。  
2. **Filter & Extractor**: 取得したテキストをローカルLLM（またはコスト効率の良いAPIモデル）に渡し、以下のプロンプトで処理。  
   * *「感情的な表現、煽りを排除し、技術的仕様変更、アーキテクチャの提案、OSSの破壊的変更、実運用上の課題の4点について客観的なファクトのみを箇条書きで抽出せよ。」*  
3. **Storage & View**: 抽出された構造化データをNotionや専用のダッシュボードに蓄積し、純度の高いインプット環境を構築。