# MyMetrix

[English](README.md)

Withingsの身体測定データと体重トレンドを扱う、セルフホスト型のシングルユーザー向けバックエンドです。Cloudflare WorkersとD1上で動作し、CLIや個人用クライアントへ型安全なHono RPCルートを提供します。

## アーキテクチャ

- HTTP境界とRPC契約はHonoが担います。
- D1のスキーマとマイグレーションはDrizzle ORM 1.0 RCが管理します。
- 測定データとWithings情報の読み取りは、Better AuthのAPIキーで保護します。
- APIキー管理とWithings接続の操作は、専用の管理トークンで保護します。
- WithingsのOAuthトークンは暗号化して保存します。
- Withingsから通知を受けると、冪等に測定データを同期します。

CLIはデプロイ済みのHTTP APIだけを呼び出します。データベースの認証情報は必要ありません。

## 前提条件

- Bun 1.4.2
- Wranglerで認証済みのCloudflareアカウント
- Cloudflare D1データベース
- Withings開発者アプリケーション

Withings開発者アプリケーションには、デプロイしたWorkerのオリジンを使って次のコールバックURLを登録します。

```text
https://<worker-origin>/oauth/withings/callback
```

## セットアップ

依存関係をインストールし、git管理外のローカル用・本番用シークレットファイルを作成します。

```bash
bun install --frozen-lockfile
cp .dev.vars.example .dev.vars
cp .dev.vars.example .prod.vars
cp .setup.env.example .setup.env
```

フォークした環境へ初めてデプロイする場合はD1データベースを作成し、返されたデータベースIDを`wrangler.jsonc`に設定します。

```bash
bunx wrangler d1 create my-metrix
```

認証・暗号化・Webhook用のシークレットは、`.dev.vars`と`.prod.vars`で別々の値を生成します。

```bash
openssl rand -hex 32 # ADMIN_TOKEN
openssl rand -hex 32 # BETTER_AUTH_SECRET
openssl rand -base64 32 # TOKEN_ENCRYPTION_KEY
openssl rand -hex 32 # WEBHOOK_SECRET
```

WithingsのクライアントIDとシークレットは両方のファイルへ設定します。`wrangler.jsonc`の`APP_URL`には、デプロイ先Workerのオリジンを指定します。

ローカルのD1へマイグレーションを適用し、Workerを起動します。

```bash
bun run db:migrate:local
bun run dev
```

本番では、シークレットの登録、リモートD1へのマイグレーション、Workerのデプロイを順に実行します。

```bash
bunx wrangler secret bulk .prod.vars
bun run db:migrate:remote
bun run deploy
```

`.setup.env`へデプロイ先URLと管理トークンを設定し、ホストされたOAuthコールバックを通じてWithingsを接続してから、測定通知を登録します。

```bash
bun run cli -- withings connect
bun run cli -- withings subscribe
```

クライアント用のAPIキーを作成し、返されたキーを`.setup.env`の`MY_METRIX_API_KEY`へ設定します。

```bash
bun run cli -- keys create --name my-client
```

ほかに`keys list`、`keys revoke --id <id>`、`withings status`、`measurements latest|recent|trend`を利用できます。

## HTTPルート

- `GET /api/health`は公開されています。
- `/api/admin/*`には管理用Bearerトークンが必要です。
- `/api/measurements/*`と`/api/withings/*`にはBetter AuthのAPIキーが必要です。
- `/api/measurements/latest`は、購読後の測定通知を同期するまでは`latest: null`を返します。
- `/oauth/withings/callback`は、有効期限の短いOAuthフローを完了します。
- `/webhooks/withings/:secret`はWithingsからの通知を受け取ります。

Webhook URLには認証情報が含まれます。ドキュメント、Issue、リクエストログ、live-tailの出力には含めないでください。

## 開発

検証スイート全体を実行します。

```bash
bun run check
```

スキーマを変更したら`bun run db:generate`でマイグレーションを生成し、Wranglerで適用します。一度適用したマイグレーションは変更しません。

## 運用

- マイグレーションの前に、本番データをエクスポートするなどしてバックアップします。新しい制約に合わないレコードは削除せず、原因を調べます。
- マイグレーションに依存するコードをデプロイする前に、マイグレーションを適用します。Wranglerはリモートマイグレーションの適用時にD1のバックアップを作成します。
- Withingsのリフレッシュトークンはローテーションされます。D1上のリースは保存結果を直列化しますが、すでに送信した外部リクエストのキャンセルや厳密な1回実行は保証しません。
- 身体データ、`.dev.vars`、`.setup.env`、APIキー、OAuthトークン、Webhook URLは、コミットや公開レポートに含めません。

## ライセンス

[MIT](LICENSE)
