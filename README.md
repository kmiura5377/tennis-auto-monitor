# 🎾 テニスコート自動監視システム

東京都立公園のテニスコート空き状況を自動監視し、新しい空きが出たら即座に通知するシステムです。

## 機能

- ✅ 15分ごとに自動的に空き状況をチェック
- ✅ 新しい空き枠が出たら即座に通知
- ✅ メール通知対応
- ✅ ブラウザプッシュ通知対応
- ✅ 前回データと比較して変更があった場合のみ通知

## セットアップ

### 1. ローカル環境での動作確認

```bash
npm install
npm run dev
```

### 2. Vercelへのデプロイ

```bash
vercel deploy
```

### 3. 環境変数の設定

Vercel ダッシュボードで以下を設定：

```
SMTP_HOST=your-email-provider
SMTP_USER=your-email@example.com
SMTP_PASS=your-app-password
NOTIFY_EMAIL=recipient@example.com
```

## 構成

```
tennis-auto-monitor/
├── api/
│   ├── scrape.js          # スクレイピング機能
│   ├── compare.js         # データ比較機能
│   └── notify.js          # 通知機能
├── lib/
│   ├── db.js              # データベース操作
│   └── parser.js          # HTML解析
├── pages/
│   ├── dashboard.html     # ダッシュボード
│   └── history.html       # 通知履歴
├── package.json
├── vercel.json           # Vercel設定
└── README.md
```

## 注意

スクレイピングは東京都の利用規約に従って実行されています。
過度なアクセスは避けてください。

## ライセンス

MIT

<!-- deploy trigger -->

