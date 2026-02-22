# KV セッション認証 設計ドキュメント

**日付**: 2026-02-22
**プロジェクト**: astro-cf-pages
**技術スタック**: Astro 5.x + Cloudflare Pages + Cloudflare KV

---

## 概要

Cloudflare Pages Functions（Astro SSR エンドポイント + ミドルウェア）と Cloudflare KV を使って、ID/パスワード認証とセッション管理を実装する。

---

## Section 1: アーキテクチャ概要

### ディレクトリ構成

```
src/
├── middleware.ts          # 認証ガード（全ルートに適用）
├── env.d.ts               # App.Locals 型定義
├── pages/
│   ├── index.astro        # ホーム（認証不要）
│   ├── login.astro        # ログインフォームUI
│   ├── dashboard.astro    # 保護ページ（認証必要）
│   └── api/
│       ├── login.ts       # POST: ログイン処理
│       ├── logout.ts      # POST: ログアウト処理
│       └── me.ts          # GET: 現在のユーザー情報
└── lib/
    ├── auth.ts            # 認証ユーティリティ（トークン生成・検証）
    ├── auth.test.ts
    └── kv.ts              # KV アクセスヘルパー
```

### KV データ構造

1つの `SESSION` KV バインディングをプレフィックスで論理分離して使用する。

```
sessions:{token}   →  { username: string, expiresAt: number }
users:{username}   →  { passwordHash: string, createdAt: string }
```

### 認証フロー

1. `POST /api/login` → パスワード検証 → セッショントークン生成 → KV に保存 → HttpOnly Cookie をセット
2. `middleware.ts` → Cookie からトークン取得 → KV で検証 → `context.locals.user` にセット
3. 保護ページは `Astro.locals.user` を確認、未認証なら `/login` にリダイレクト

---

## Section 2: API エンドポイントと KV バインディング

### KV バインディング（wrangler.jsonc）

既存の `SESSION` KV 1つを継続使用。新規 KV は追加しない。

### エンドポイント仕様

| エンドポイント | メソッド | 入力 | 出力 |
|---|---|---|---|
| `/api/login` | POST | `{ username, password }` (JSON) | 200 + Cookie / 401 |
| `/api/logout` | POST | なし | 200 + Cookie 削除 |
| `/api/me` | GET | なし | `{ username }` / 401 |

### Cookie 仕様

- 名前: `session_token`
- 属性: `HttpOnly`, `Secure`, `SameSite=Strict`
- 有効期限: 24時間（KV TTL と同期）

### パスワードハッシュ

`crypto.subtle.digest`（Web Crypto API）で SHA-256 ハッシュ化。Cloudflare Workers ランタイムでネイティブ動作。

### API Routes での KV アクセス

`.ts` ファイルでは `context.env` を直接使用する（公式推奨パターン）。

```ts
// src/pages/api/login.ts
export const POST: APIRoute = async (context) => {
  const kv = context.env.SESSION;  // context.env を直接使う
  // ...
};
```

---

## Section 3: ミドルウェアとエラーハンドリング

### middleware.ts の動作フロー

```
リクエスト到来
  ↓
Cookie から session_token を取得
  ↓
トークンあり → KV で sessions:{token} を検索
  ├── 存在 & 有効期限内 → context.locals.user = { username } → 次へ
  └── 存在しない or 期限切れ → context.locals.user = null → 次へ
  ↓
トークンなし → context.locals.user = null → 次へ
  ↓
保護ルート（/dashboard など）で user が null → /login にリダイレクト
```

ミドルウェアはブロックしない設計。`context.locals.user` をセットするだけで、リダイレクトは各ページが判断する。

### 型定義（src/env.d.ts）

`Runtime` を継承する公式推奨パターンを使用。`runtime` プロパティは手動定義不要。

```ts
// src/env.d.ts
type Runtime = import("@astrojs/cloudflare").Runtime<Env>;

declare namespace App {
  interface Locals extends Runtime {
    user: { username: string } | null;
  }
}
```

### エラーハンドリング方針

| 状況 | 挙動 |
|---|---|
| KV アクセス失敗 | 500 エラー、詳細はサーバーログ |
| 無効な認証情報 | 401、「ユーザー名またはパスワードが違います」（どちらが間違いか伝えない） |
| セッション期限切れ | Cookie 削除 + `/login` にリダイレクト |
| 不正な入力値 | 400、バリデーションエラー詳細を返す |

---

## Section 4: テスト戦略

### 推奨ツール

**Vitest + `@cloudflare/vitest-pool-workers`**

Cloudflare が公式提供するテストプール。Workers ランタイム互換環境でテストが実行でき、KV のインメモリモックを標準サポート。

### テスト構成

| テスト対象 | テスト種別 | 確認内容 |
|---|---|---|
| `src/lib/auth.ts` | Unit | パスワードハッシュ・検証、トークン生成の一意性 |
| `POST /api/login` | Integration | 正常ログイン→Cookie付きレスポンス、誤パスワード→401 |
| `POST /api/logout` | Integration | Cookie 削除レスポンス |
| `middleware.ts` | Integration | 有効セッション→`locals.user` セット、無効→null |

### vitest 設定

```ts
// vitest.config.ts
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.jsonc" },
      },
    },
  },
});
```

---

## 決定事項まとめ

- KV は 1 つ（`SESSION`）をプレフィックスで論理分離して使用
- 認証方式: ID/パスワード + HttpOnly Cookie セッション
- ミドルウェアはノンブロッキング設計（各ページがリダイレクト判断）
- API Routes では `context.env` で KV に直接アクセス
- `App.Locals` は `Runtime` 継承パターンで型定義
- テスト: `@cloudflare/vitest-pool-workers` を使用
