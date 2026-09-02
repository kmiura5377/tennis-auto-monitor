# 🎾 テニスコート空き状況カレンダー

東京都立公園（都立公園スポーツレクリエーション予約システム）のテニスコート空き状況を、月間カレンダー形式で確認できるシステムです。

## 仕組み

- GitHub Actions が **1時間に1回**、Playwright（ヘッドレスブラウザ）で予約サイトを実際に操作し、直近5週間分の空き状況を取得します
- 取得結果は `data/availability.json` としてリポジトリにコミットされ、Vercel が自動的に再デプロイします
- フロントエンド（`index.html`）はこの静的JSONを読み込んで、月間カレンダーとして表示します

### なぜ月表示APIを使わないのか

予約サイトには本来「1ヶ月空き表示」という月間カレンダーAPIがありますが、ヘッドレスブラウザからのアクセスに対してこのAPIだけ応答が返らない（ハングする）現象を確認しました。意図的な自動アクセス検知の可能性があるため、代わりに問題なく動作する「週表示」を5回ページ送りして月相当のデータを組み立てています。

### アクセス頻度について

予約サイトは利用規約で「過剰な自動アクセス」を明示的に禁止しており、検知した場合はアクセス遮断やアカウント停止を行うとしています。これを踏まえ、チェック頻度は15分ごとではなく **1時間に1回** に抑えています。

## 監視対象施設

`scripts/scrape.js` の `FACILITIES` に定義された全31施設（人工芝27施設・ハードコート4施設）。実際に予約サイトで検索できる公園・コートすべてを対象としています。

## 新規空き通知（Discord）

前回の取得結果と比較して新しく空きが出た枠があれば、Discordに通知します。

1. Discordサーバーで「サーバー設定 → 連携サービス → ウェブフック」からウェブフックURLを作成
2. GitHubリポジトリの Settings → Secrets and variables → Actions で `DISCORD_WEBHOOK_URL` という名前のSecretを追加し、そのURLを設定

設定しない場合は通知は送られず、カレンダーの更新のみが行われます。

## 構成

```
tennis-auto-monitor/
├── index.html                  # 月間カレンダーUI
├── data/
│   └── availability.json       # スクレイピング結果（GitHub Actionsが更新）
├── scripts/
│   └── scrape.js                # Playwrightスクレイパー本体
├── .github/workflows/
│   └── monitor.yml             # 1時間ごとにスクレイパーを実行するGitHub Actions
├── package.json
└── README.md
```

## ローカルでの実行

```bash
npm install
npx playwright install chromium
npm run scrape
```

`data/availability.json` が更新されます。

## 注意

- 表示されるのは実データですが、取得できているのは直近5週間程度です。それ以外の日付はカレンダー上で「-」と表示されます
- 予約サイトの構造が変わると `scripts/scrape.js` の修正が必要になります

## ライセンス

MIT
