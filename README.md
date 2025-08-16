# 30s English News

日常のニュースを英語で読みながら勉強できるウェブアプリケーション

## 🌟 機能

- **レベル別学習**: 初心者・中級者・上級者の3段階
- **カテゴリー選択**: ライフスタイル、社会、経済、エンタメ、テクノロジー
- **NewsData.io API**: 実際の日本国内ニュースを取得
- **GPT-5による記事整形**: レベル別英文化と語彙・文法解説
- **TTS音声再生**: gpt-4o-mini-TTSによる4種類のネイティブ音声
- **重複排除**: 過去15記事との重複を自動検出・排除
- **レスポンシブUI**: PC・タブレット・スマホ対応

## 🚀 セットアップ

### 1. 依存関係のインストール

```bash
cd "30s English News"
npm install
```

### 2. 環境変数の設定

`.env.example`をコピーして`.env`を作成：

```bash
cp .env.example .env
```

`.env`ファイルで以下を設定：

```env
OPENAI_API_KEY=sk-your-actual-api-key-here
NEWSDATA_API_KEY=pub_your-newsdata-api-key-here
OPENAI_BASE_URL=https://api.openai.com/v1
NEWSDATA_BASE_URL=https://newsdata.io/api/1
TTS_MODEL=gpt-4o-mini-tts
MAX_ARTICLES=5
PORT=3000
BASE_URL=http://localhost:3000
```

### 3. サーバー起動

```bash
# 開発モード（自動再起動）
npm run dev

# 本番モード
npm start
```

### 4. アクセス

- ローカル: http://localhost:3000
- ローカルネットワーク: http://192.168.179.21:3000

## 📁 プロジェクト構造

```
30s English News/
├── index.html          # レベル・カテゴリ選択画面
├── news-list.html      # ニュース一覧画面
├── article.html        # 記事詳細画面
├── styles.css          # スタイルシート（レスポンシブ対応）
├── selection.js        # 選択画面のJavaScript
├── news-list.js        # ニュース一覧のJavaScript
├── article.js          # 記事詳細のJavaScript
├── server.js           # Express サーバー
├── api/
│   ├── news.js         # NewsData.io統合・GPT-5処理
│   └── tts.js          # gpt-4o-mini-TTS音声生成
├── audio/              # 音声ファイル（自動生成）
├── .env                # 環境変数
└── package.json        # Node.js設定
```

## 🔧 API エンドポイント

### ニュース検索
- `POST /api/news/search`
- Body: `{ "level": "beginner", "categories": ["tech", "economy"] }`
- Response: 5件の実際のニュース記事（英語化・解説付き）

### 記事内容処理
- `POST /api/news/process-article-content`
- Body: `{ "article": {...}, "level": "intermediate" }`

### 音声・翻訳生成
- `POST /api/news/generate-audio-translation`
- Body: `{ "en_body": "text", "level": "advanced" }`
- Response: 4種類のネイティブ音声（US/UK Male/Female）

### TTS音声生成
- `POST /api/tts/generate`
- Body: `{ "text": "Hello world", "level": "beginner", "voice": "alloy" }`

### 音声ファイル配信
- `GET /audio/{filename}.mp3`

## 🎯 使用技術

### フロントエンド
- **Vanilla JavaScript** - フレームワークなし
- **CSS3** - アニメーション・レスポンシブ対応
- **Web Speech API** - フォールバック音声再生

### バックエンド
- **Node.js + Express** - APIサーバー
- **NewsData.io API** - 日本国内ニュース取得
- **OpenAI GPT-5** - 記事整形・英語化（Responses API）
- **gpt-4o-mini-TTS** - 高品質音声合成
- **Crypto** - ハッシュ生成・重複排除

## ⚡ パフォーマンス最適化

- **段階的読み込み**: 英語本文→音声・翻訳の順で処理
- **音声ファイルキャッシュ**: 同じテキストは再利用
- **重複排除**: 過去15記事との重複防止システム
- **レート制限**: NewsData.io API呼び出し間隔制御
- **エラーハンドリング**: 各処理段階での適切なフォールバック

## 🔒 セキュリティ

- **環境変数**: APIキーの安全な管理
- **ファイル検証**: 音声ファイル名の検証
- **CORS設定**: クロスオリジン制御
- **入力検証**: APIリクエストの検証

## 🐛 トラブルシューティング

### NewsData.io API エラー
```
Error: NewsData.ioからニュースが取得できませんでした
```
- `.env`ファイルで`NEWSDATA_API_KEY`を確認
- NewsData.ioアカウントの利用制限を確認

### OpenAI API エラー
```
Error: 401 Unauthorized
```
- `.env`ファイルで`OPENAI_API_KEY`を確認
- OpenAIアカウントの残高を確認
- GPT-5 Responses APIへのアクセス権限を確認

### 重複ニュースエラー
```
実際のニュースを取得できませんでした
```
- 過去の履歴が多すぎる場合、サーバー再起動で解決
- 別カテゴリーを選択してみる

### 音声再生エラー
- ブラウザの自動再生ポリシーを確認
- 4種類の音声オプションから選択可能

### ネットワークアクセスエラー
- ローカルネットワーク: http://192.168.179.21:3000
- ファイアウォール設定を確認

### ポート占有エラー
```bash
# ポート3000を使用中のプロセスを終了
lsof -ti:3000 | xargs kill -9
```

## 📝 ライセンス

MIT License

## 🤝 貢献

1. このリポジトリをフォーク
2. フィーチャーブランチを作成 (`git checkout -b feature/amazing-feature`)
3. 変更をコミット (`git commit -m 'Add amazing feature'`)
4. ブランチにプッシュ (`git push origin feature/amazing-feature`)
5. プルリクエストを作成

## 📊 技術仕様

### レベル別語数設定
- **初心者 (A2)**: 120-200語
- **中級者 (B1)**: 200-300語  
- **上級者 (C1)**: 300-400語

### 音声オプション
- **US Male Native** (alloy)
- **US Female Native** (echo) 
- **UK Male Native** (fable)
- **UK Female Native** (onyx)

### カテゴリマッピング
- lifestyle → lifestyle
- society → politics
- economy → business
- entertainment → entertainment
- tech → technology
- all → top

## 📊 今後の機能

- [ ] ユーザー進捗保存
- [ ] 学習履歴・統計
- [ ] お気に入り記事
- [ ] ソーシャル共有
- [ ] PWA対応
- [ ] 多言語対応