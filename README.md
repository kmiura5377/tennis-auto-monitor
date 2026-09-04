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

## お気に入り・通知購読の保存先（Vercel KV）

お気に入り設定とWeb Push購読情報は、Vercelの KV ストレージ（Upstashのマーケットプレイス連携）に保存されます。

セットアップ（初回のみ）:

1. Vercelダッシュボード → プロジェクト → Storage タブ → 「Upstash for Redis」を作成して接続
   （`KV_REST_API_URL` / `KV_REST_API_TOKEN` が自動的に環境変数として追加されます）
2. Vercelの環境変数に `FAVORITES_API_TOKEN`（任意のランダムな文字列）を追加
3. GitHubリポジトリの Secret にも同じ値を `FAVORITES_API_TOKEN` として追加
   （`scripts/scrape.js` が全利用者分の設定を取得する際に必要）

## 監視対象施設

`scripts/scrape.js` の `FACILITIES` に定義された全31施設（人工芝27施設・ハードコート4施設）。実際に予約サイトで検索できる公園・コートすべてを対象としています。

## PWA化 / スマホへのプッシュ通知

このサイトはPWA（Progressive Web App）として作られており、スマホでホーム画面に追加するとアプリのように使えます（アイコン付き）。

新しく空きが出た枠があれば、ブラウザのプッシュ通知（Web Push）でスマホに直接通知が届きます。

### 通知の設定手順

1. サイトを開き、「🔔 新規空きの通知を有効にする」ボタンを押して通知を許可する（購読情報は自動的にサーバーに保存されます。コピー&貼り付けは不要）
2. GitHubリポジトリの Settings → Secrets and variables → Actions で `PUSH_VAPID_PRIVATE_KEY`（プロジェクト作成時に生成したVAPID秘密鍵）を設定する

設定しない場合は通知は送られず、カレンダーの更新のみが行われます。

### 複数人で使う（簡易リンク方式）

このサイトは `?u=<任意のID>` というURLパラメータで利用者を区別できます。

- 自分用: `https://tennis-auto-monitor.vercel.app/`（`u`省略時は自動的に `me` として扱われる）
- 友人用: `https://tennis-auto-monitor.vercel.app/?u=好きな文字列`

友人にこのリンクを渡すと、その人は自分だけのお気に入り・通知設定を持てます（あなたの設定には一切影響しません）。ただし**本格的なログインではなく「リンクを知っていればアクセスできる」方式**なので、渡した相手がさらに別の人にリンクを転送すれば、その人もアクセスできてしまう点に注意してください。

### LINE通知（任意）

Web Pushに加えて、LINE公式アカウントの「ブロードキャスト配信」でも通知を送れます。

1. [LINE Developers Console](https://developers.line.biz/) でMessaging APIチャネルを作成
2. チャネルアクセストークン（長期）を発行してコピー
3. 表示されるQRコードを自分のLINEで友達追加
4. GitHubリポジトリの Secret に `LINE_CHANNEL_ACCESS_TOKEN` としてトークンを設定

※ ブロードキャスト配信は「その公式アカウントを友達登録している全員」に届きます。友達追加のリンク/QRコードを他人と共有しない限り、実質あなただけに届きます。

## 構成

```
tennis-auto-monitor/
├── index.html                  # 月間カレンダーUI（PWA対応）
├── manifest.json                # PWAマニフェスト
├── sw.js                        # サービスワーカー（プッシュ通知の受信）
├── icons/                       # PWA/ホーム画面用アイコン
├── assets/icon.svg              # アイコンの元データ
├── data/
│   └── availability.json       # スクレイピング結果（GitHub Actionsが更新）
├── scripts/
│   └── scrape.js                # Playwrightスクレイパー + 通知送信
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
