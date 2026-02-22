# KV セッション認証 実装計画

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Astro SSR エンドポイント + Cloudflare KV を使って ID/パスワード認証とセッション管理を実装する

**Architecture:** `src/middleware.ts` で全ルートのセッション検証を行い `context.locals.user` にセット。`src/pages/api/` の SSR エンドポイントでログイン・ログアウトを処理。Cloudflare KV の `SESSION` バインディング 1 つをプレフィックスで論理分離して使用する。

**Tech Stack:** Astro 5.x, @astrojs/cloudflare, Cloudflare KV, Vitest, @cloudflare/vitest-pool-workers

---

## 前提知識

- `src/env.d.ts`: `App.Locals` の型定義ファイル。すでに `interface Locals extends Runtime {}` が存在する
- `worker-configuration.d.ts`: Wrangler 自動生成。`Env` に `SESSION: KVNamespace` が定義済み
- `wrangler.jsonc`: `SESSION` KV バインディングが設定済み（id: `715b41f83f6e44559449c9414f4339bb`）
- `CartButton.astro`: `Astro.session?.get("cart")` で KV を使用中（変更しない）
- テストは `@cloudflare/vitest-pool-workers` で Workers ランタイム上で実行する

## KV キー設計

```
sessions:{token}   →  JSON: { username: string, expiresAt: number }
users:{username}   →  JSON: { passwordHash: string, createdAt: string }
```

---

## Task 1: テスト環境のセットアップ

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json`（`test` スクリプト追加）

**Step 1: 依存パッケージをインストール**

```bash
pnpm add -D vitest @cloudflare/vitest-pool-workers
```

Expected: `node_modules/@cloudflare/vitest-pool-workers` が作成される

**Step 2: vitest.config.ts を作成**

```ts
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

**Step 3: package.json に test スクリプトを追加**

`"scripts"` に以下を追加：

```json
"test": "vitest run",
"test:watch": "vitest"
```

**Step 4: 動作確認**

```bash
pnpm test
```

Expected: "No test files found" などのメッセージが出て正常終了（エラーなし）

**Step 5: コミット**

```bash
git add vitest.config.ts package.json pnpm-lock.yaml
git commit -m "chore: add vitest with cloudflare workers pool"
```

---

## Task 2: 型定義の更新

**Files:**
- Modify: `src/env.d.ts`

**Step 1: `src/env.d.ts` を修正して `user` プロパティを追加**

現在の内容:
```ts
type Runtime = import("@astrojs/cloudflare").Runtime<Env>;

declare namespace App {
  interface Locals extends Runtime {}
}
```

変更後:
```ts
type Runtime = import("@astrojs/cloudflare").Runtime<Env>;

declare namespace App {
  interface Locals extends Runtime {
    user: { username: string } | null;
  }
}
```

**Step 2: 型チェックで問題がないか確認**

```bash
pnpm astro check
```

Expected: エラーなしで終了

**Step 3: コミット**

```bash
git add src/env.d.ts
git commit -m "feat: add user to App.Locals type definition"
```

---

## Task 3: 認証ユーティリティの実装（TDD）

**Files:**
- Create: `src/lib/auth.ts`
- Create: `src/lib/auth.test.ts`

### パスワードハッシュとトークン生成の関数を実装する

**Step 1: 失敗するテストを書く**

`src/lib/auth.test.ts` を作成：

```ts
import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword, generateToken } from "./auth";

describe("hashPassword", () => {
  it("同じ入力から同じハッシュを生成する", async () => {
    const hash1 = await hashPassword("mypassword");
    const hash2 = await hashPassword("mypassword");
    expect(hash1).toBe(hash2);
  });

  it("異なる入力から異なるハッシュを生成する", async () => {
    const hash1 = await hashPassword("password1");
    const hash2 = await hashPassword("password2");
    expect(hash1).not.toBe(hash2);
  });

  it("空文字列もハッシュ化できる", async () => {
    const hash = await hashPassword("");
    expect(typeof hash).toBe("string");
    expect(hash.length).toBeGreaterThan(0);
  });
});

describe("verifyPassword", () => {
  it("正しいパスワードはtrueを返す", async () => {
    const hash = await hashPassword("correct");
    expect(await verifyPassword("correct", hash)).toBe(true);
  });

  it("誤ったパスワードはfalseを返す", async () => {
    const hash = await hashPassword("correct");
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });
});

describe("generateToken", () => {
  it("32バイト以上のランダムな文字列を返す", () => {
    const token = generateToken();
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThanOrEqual(64); // hex エンコードで64文字
  });

  it("呼び出しごとに異なる値を返す", () => {
    const token1 = generateToken();
    const token2 = generateToken();
    expect(token1).not.toBe(token2);
  });
});
```

**Step 2: テストが失敗することを確認**

```bash
pnpm test src/lib/auth.test.ts
```

Expected: FAIL "Cannot find module './auth'"

**Step 3: 最小実装を書く**

`src/lib/auth.ts` を作成：

```ts
export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  const inputHash = await hashPassword(password);
  return inputHash === hash;
}

export function generateToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
```

**Step 4: テストが通ることを確認**

```bash
pnpm test src/lib/auth.test.ts
```

Expected: PASS 全テスト

**Step 5: コミット**

```bash
git add src/lib/auth.ts src/lib/auth.test.ts
git commit -m "feat: add auth utilities (hashPassword, verifyPassword, generateToken)"
```

---

## Task 4: KV ヘルパーの実装（TDD）

**Files:**
- Create: `src/lib/kv.ts`
- Create: `src/lib/kv.test.ts`

### セッションとユーザーの CRUD ヘルパーを実装する

**Step 1: 失敗するテストを書く**

`src/lib/kv.test.ts` を作成：

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import {
  saveSession,
  getSession,
  deleteSession,
  saveUser,
  getUser,
} from "./kv";

const SESSION_TTL = 60 * 60 * 24; // 24時間

describe("saveSession / getSession", () => {
  it("セッションを保存して取得できる", async () => {
    const token = "test-token-123";
    const data = { username: "alice", expiresAt: Date.now() + SESSION_TTL * 1000 };
    await saveSession(env.SESSION, token, data, SESSION_TTL);
    const result = await getSession(env.SESSION, token);
    expect(result).toEqual(data);
  });

  it("存在しないトークンはnullを返す", async () => {
    const result = await getSession(env.SESSION, "nonexistent-token");
    expect(result).toBeNull();
  });
});

describe("deleteSession", () => {
  it("セッションを削除できる", async () => {
    const token = "delete-me-token";
    const data = { username: "bob", expiresAt: Date.now() + SESSION_TTL * 1000 };
    await saveSession(env.SESSION, token, data, SESSION_TTL);
    await deleteSession(env.SESSION, token);
    const result = await getSession(env.SESSION, token);
    expect(result).toBeNull();
  });
});

describe("saveUser / getUser", () => {
  it("ユーザーを保存して取得できる", async () => {
    const userData = { passwordHash: "abc123hash", createdAt: new Date().toISOString() };
    await saveUser(env.SESSION, "alice", userData);
    const result = await getUser(env.SESSION, "alice");
    expect(result).toEqual(userData);
  });

  it("存在しないユーザーはnullを返す", async () => {
    const result = await getUser(env.SESSION, "nobody");
    expect(result).toBeNull();
  });
});
```

**Step 2: テストが失敗することを確認**

```bash
pnpm test src/lib/kv.test.ts
```

Expected: FAIL "Cannot find module './kv'"

**Step 3: 最小実装を書く**

`src/lib/kv.ts` を作成：

```ts
export type SessionData = {
  username: string;
  expiresAt: number;
};

export type UserData = {
  passwordHash: string;
  createdAt: string;
};

export async function saveSession(
  kv: KVNamespace,
  token: string,
  data: SessionData,
  ttlSeconds: number
): Promise<void> {
  await kv.put(`sessions:${token}`, JSON.stringify(data), {
    expirationTtl: ttlSeconds,
  });
}

export async function getSession(
  kv: KVNamespace,
  token: string
): Promise<SessionData | null> {
  return await kv.get<SessionData>(`sessions:${token}`, "json");
}

export async function deleteSession(
  kv: KVNamespace,
  token: string
): Promise<void> {
  await kv.delete(`sessions:${token}`);
}

export async function saveUser(
  kv: KVNamespace,
  username: string,
  data: UserData
): Promise<void> {
  await kv.put(`users:${username}`, JSON.stringify(data));
}

export async function getUser(
  kv: KVNamespace,
  username: string
): Promise<UserData | null> {
  return await kv.get<UserData>(`users:${username}`, "json");
}
```

**Step 4: テストが通ることを確認**

```bash
pnpm test src/lib/kv.test.ts
```

Expected: PASS 全テスト

**Step 5: コミット**

```bash
git add src/lib/kv.ts src/lib/kv.test.ts
git commit -m "feat: add KV helper functions for sessions and users"
```

---

## Task 5: ミドルウェアの実装（TDD）

**Files:**
- Create: `src/middleware.ts`
- Create: `src/middleware.test.ts`

### セッション検証と `locals.user` のセットを実装する

**Step 1: 失敗するテストを書く**

`src/middleware.test.ts` を作成：

```ts
import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import { saveSession } from "./lib/kv";

// ミドルウェアの動作を直接テストするためのヘルパー
async function makeRequest(cookie?: string) {
  const headers = new Headers();
  if (cookie) {
    headers.set("Cookie", cookie);
  }
  const request = new Request("http://localhost/dashboard", { headers });
  // middleware の onRequest を直接呼び出すのは難しいため、
  // getSession ロジックを切り出した関数をテストする
  return request;
}

// middleware から切り出したセッション解決ロジックをテスト
import { resolveSession } from "./middleware";

describe("resolveSession", () => {
  it("有効なセッショントークンがあればユーザー情報を返す", async () => {
    const token = "valid-token-abc";
    await saveSession(
      env.SESSION,
      token,
      { username: "alice", expiresAt: Date.now() + 86400000 },
      86400
    );

    const user = await resolveSession(env.SESSION, token);
    expect(user).toEqual({ username: "alice" });
  });

  it("存在しないトークンはnullを返す", async () => {
    const user = await resolveSession(env.SESSION, "no-such-token");
    expect(user).toBeNull();
  });

  it("undefinedトークンはnullを返す", async () => {
    const user = await resolveSession(env.SESSION, undefined);
    expect(user).toBeNull();
  });
});
```

**Step 2: テストが失敗することを確認**

```bash
pnpm test src/middleware.test.ts
```

Expected: FAIL "Cannot find module './middleware'" or "resolveSession is not exported"

**Step 3: ミドルウェアを実装する**

`src/middleware.ts` を作成：

```ts
import { defineMiddleware } from "astro:middleware";
import { getSession, type SessionData } from "./lib/kv";

export async function resolveSession(
  kv: KVNamespace,
  token: string | undefined
): Promise<{ username: string } | null> {
  if (!token) return null;

  const session = await getSession(kv, token);
  if (!session) return null;

  if (Date.now() > session.expiresAt) {
    await kv.delete(`sessions:${token}`);
    return null;
  }

  return { username: session.username };
}

export const onRequest = defineMiddleware(async (context, next) => {
  const token = context.cookies.get("session_token")?.value;
  const kv = context.locals.runtime.env.SESSION;

  context.locals.user = await resolveSession(kv, token);

  return next();
});
```

**Step 4: テストが通ることを確認**

```bash
pnpm test src/middleware.test.ts
```

Expected: PASS 全テスト

**Step 5: コミット**

```bash
git add src/middleware.ts src/middleware.test.ts
git commit -m "feat: add auth middleware with session resolution"
```

---

## Task 6: ログイン API エンドポイントの実装（TDD）

**Files:**
- Create: `src/pages/api/login.ts`
- Create: `src/pages/api/login.test.ts`

### POST /api/login を実装する

**Step 1: 失敗するテストを書く**

`src/pages/api/login.test.ts` を作成：

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { saveUser } from "../../lib/kv";
import { hashPassword } from "../../lib/auth";

// エンドポイントの fetch ハンドラをテスト用にラップするヘルパー
// Astro の APIRoute は通常の Request/Response を扱うため直接テスト可能
import { handleLogin } from "./login";

describe("POST /api/login", () => {
  beforeEach(async () => {
    const passwordHash = await hashPassword("password123");
    await saveUser(env.SESSION, "testuser", {
      passwordHash,
      createdAt: new Date().toISOString(),
    });
  });

  it("正しい認証情報でログインするとCookieが設定される", async () => {
    const request = new Request("http://localhost/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "testuser", password: "password123" }),
    });

    const response = await handleLogin(request, env.SESSION);

    expect(response.status).toBe(200);
    const setCookie = response.headers.get("Set-Cookie");
    expect(setCookie).toContain("session_token=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Strict");
  });

  it("誤ったパスワードで401を返す", async () => {
    const request = new Request("http://localhost/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "testuser", password: "wrong" }),
    });

    const response = await handleLogin(request, env.SESSION);
    expect(response.status).toBe(401);
  });

  it("存在しないユーザーで401を返す", async () => {
    const request = new Request("http://localhost/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "nobody", password: "password" }),
    });

    const response = await handleLogin(request, env.SESSION);
    expect(response.status).toBe(401);
  });

  it("username/passwordが欠けていると400を返す", async () => {
    const request = new Request("http://localhost/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "testuser" }),
    });

    const response = await handleLogin(request, env.SESSION);
    expect(response.status).toBe(400);
  });
});
```

**Step 2: テストが失敗することを確認**

```bash
pnpm test src/pages/api/login.test.ts
```

Expected: FAIL "Cannot find module './login'"

**Step 3: エンドポイントを実装する**

`src/pages/api/login.ts` を作成：

```ts
import type { APIRoute } from "astro";
import { getUser, saveSession } from "../../lib/kv";
import { verifyPassword, generateToken } from "../../lib/auth";

const SESSION_TTL = 60 * 60 * 24; // 24時間（秒）

export async function handleLogin(
  request: Request,
  kv: KVNamespace
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as Record<string, unknown>).username !== "string" ||
    typeof (body as Record<string, unknown>).password !== "string"
  ) {
    return new Response(
      JSON.stringify({ error: "username and password are required" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const { username, password } = body as { username: string; password: string };

  const user = await getUser(kv, username);
  if (!user) {
    return new Response(
      JSON.stringify({ error: "ユーザー名またはパスワードが違います" }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    return new Response(
      JSON.stringify({ error: "ユーザー名またはパスワードが違います" }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  const token = generateToken();
  await saveSession(
    kv,
    token,
    { username, expiresAt: Date.now() + SESSION_TTL * 1000 },
    SESSION_TTL
  );

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": `session_token=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_TTL}`,
    },
  });
}

export const prerender = false;

export const POST: APIRoute = async (context) => {
  return handleLogin(context.request, context.env.SESSION);
};
```

**Step 4: テストが通ることを確認**

```bash
pnpm test src/pages/api/login.test.ts
```

Expected: PASS 全テスト

**Step 5: コミット**

```bash
git add src/pages/api/login.ts src/pages/api/login.test.ts
git commit -m "feat: add POST /api/login endpoint with KV session"
```

---

## Task 7: ログアウト・me API エンドポイントの実装（TDD）

**Files:**
- Create: `src/pages/api/logout.ts`
- Create: `src/pages/api/logout.test.ts`
- Create: `src/pages/api/me.ts`
- Create: `src/pages/api/me.test.ts`

### POST /api/logout と GET /api/me を実装する

**Step 1: logout の失敗するテストを書く**

`src/pages/api/logout.test.ts` を作成：

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { saveSession, getSession } from "../../lib/kv";
import { handleLogout } from "./logout";

describe("POST /api/logout", () => {
  it("セッショントークンのCookieを削除する", async () => {
    const token = "logout-token-xyz";
    await saveSession(
      env.SESSION,
      token,
      { username: "alice", expiresAt: Date.now() + 86400000 },
      86400
    );

    const request = new Request("http://localhost/api/logout", {
      method: "POST",
      headers: { Cookie: `session_token=${token}` },
    });

    const response = await handleLogout(request, env.SESSION);

    expect(response.status).toBe(200);
    const setCookie = response.headers.get("Set-Cookie");
    expect(setCookie).toContain("session_token=;");
    expect(setCookie).toContain("Max-Age=0");
  });

  it("セッションがKVから削除される", async () => {
    const token = "delete-session-token";
    await saveSession(
      env.SESSION,
      token,
      { username: "bob", expiresAt: Date.now() + 86400000 },
      86400
    );

    const request = new Request("http://localhost/api/logout", {
      method: "POST",
      headers: { Cookie: `session_token=${token}` },
    });

    await handleLogout(request, env.SESSION);

    const session = await getSession(env.SESSION, token);
    expect(session).toBeNull();
  });

  it("Cookieなしでも200を返す（冪等性）", async () => {
    const request = new Request("http://localhost/api/logout", {
      method: "POST",
    });

    const response = await handleLogout(request, env.SESSION);
    expect(response.status).toBe(200);
  });
});
```

**Step 2: me の失敗するテストを書く**

`src/pages/api/me.test.ts` を作成：

```ts
import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import { saveSession } from "../../lib/kv";
import { handleMe } from "./me";

describe("GET /api/me", () => {
  it("有効なセッションがあればユーザー名を返す", async () => {
    const token = "me-valid-token";
    await saveSession(
      env.SESSION,
      token,
      { username: "charlie", expiresAt: Date.now() + 86400000 },
      86400
    );

    const request = new Request("http://localhost/api/me", {
      headers: { Cookie: `session_token=${token}` },
    });

    const response = await handleMe(request, env.SESSION);
    expect(response.status).toBe(200);
    const body = await response.json() as { username: string };
    expect(body.username).toBe("charlie");
  });

  it("セッションなしで401を返す", async () => {
    const request = new Request("http://localhost/api/me");
    const response = await handleMe(request, env.SESSION);
    expect(response.status).toBe(401);
  });
});
```

**Step 3: テストが失敗することを確認**

```bash
pnpm test src/pages/api/logout.test.ts src/pages/api/me.test.ts
```

Expected: FAIL（モジュールが存在しない）

**Step 4: logout を実装する**

`src/pages/api/logout.ts` を作成：

```ts
import type { APIRoute } from "astro";
import { deleteSession } from "../../lib/kv";

export async function handleLogout(
  request: Request,
  kv: KVNamespace
): Promise<Response> {
  const cookieHeader = request.headers.get("Cookie") ?? "";
  const match = cookieHeader.match(/session_token=([^;]+)/);
  const token = match?.[1];

  if (token) {
    await deleteSession(kv, token);
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie":
        "session_token=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0",
    },
  });
}

export const prerender = false;

export const POST: APIRoute = async (context) => {
  return handleLogout(context.request, context.env.SESSION);
};
```

**Step 5: me を実装する**

`src/pages/api/me.ts` を作成：

```ts
import type { APIRoute } from "astro";
import { getSession } from "../../lib/kv";

export async function handleMe(
  request: Request,
  kv: KVNamespace
): Promise<Response> {
  const cookieHeader = request.headers.get("Cookie") ?? "";
  const match = cookieHeader.match(/session_token=([^;]+)/);
  const token = match?.[1];

  if (!token) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const session = await getSession(kv, token);
  if (!session || Date.now() > session.expiresAt) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ username: session.username }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

export const prerender = false;

export const GET: APIRoute = async (context) => {
  return handleMe(context.request, context.env.SESSION);
};
```

**Step 6: テストが通ることを確認**

```bash
pnpm test src/pages/api/logout.test.ts src/pages/api/me.test.ts
```

Expected: PASS 全テスト

**Step 7: コミット**

```bash
git add src/pages/api/logout.ts src/pages/api/logout.test.ts src/pages/api/me.ts src/pages/api/me.test.ts
git commit -m "feat: add POST /api/logout and GET /api/me endpoints"
```

---

## Task 8: ログインページと保護ページの実装

**Files:**
- Create: `src/pages/login.astro`
- Create: `src/pages/dashboard.astro`

※ これらは UI コンポーネントのためユニットテストは不要。ブラウザで動作確認する。

**Step 1: ログインページを作成**

`src/pages/login.astro` を作成：

```astro
---
export const prerender = false;

// すでにログイン済みならダッシュボードへ
if (Astro.locals.user) {
  return Astro.redirect("/dashboard");
}

const error = Astro.url.searchParams.get("error");
---

<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width" />
    <title>ログイン</title>
  </head>
  <body>
    <h1>ログイン</h1>
    {error && <p style="color:red">{error}</p>}
    <form method="post" action="/api/login" id="login-form">
      <label>
        ユーザー名
        <input type="text" name="username" required />
      </label>
      <br />
      <label>
        パスワード
        <input type="password" name="password" required />
      </label>
      <br />
      <button type="submit">ログイン</button>
    </form>
    <script>
      document.getElementById("login-form")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const form = e.target as HTMLFormElement;
        const data = Object.fromEntries(new FormData(form));

        const res = await fetch("/api/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });

        if (res.ok) {
          window.location.href = "/dashboard";
        } else {
          const body = await res.json() as { error: string };
          window.location.href = `/login?error=${encodeURIComponent(body.error)}`;
        }
      });
    </script>
  </body>
</html>
```

**Step 2: ダッシュボードページを作成**

`src/pages/dashboard.astro` を作成：

```astro
---
export const prerender = false;

// 未認証ならログインへ
if (!Astro.locals.user) {
  return Astro.redirect("/login");
}

const { username } = Astro.locals.user;
---

<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width" />
    <title>ダッシュボード</title>
  </head>
  <body>
    <h1>ダッシュボード</h1>
    <p>ようこそ、{username} さん</p>
    <form method="post" action="/api/logout" id="logout-form">
      <button type="submit">ログアウト</button>
    </form>
    <script>
      document.getElementById("logout-form")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        await fetch("/api/logout", { method: "POST" });
        window.location.href = "/login";
      });
    </script>
  </body>
</html>
```

**Step 3: ローカルで動作確認**

```bash
pnpm preview
```

ブラウザで以下を確認：
- `/dashboard` にアクセス → `/login` にリダイレクトされる
- `/login` でフォームが表示される

（注意: ログインするにはユーザーを事前に KV に登録する必要がある。Task 9 で登録スクリプトを作成する）

**Step 4: コミット**

```bash
git add src/pages/login.astro src/pages/dashboard.astro
git commit -m "feat: add login page and protected dashboard page"
```

---

## Task 9: ユーザー登録スクリプト（開発用）

**Files:**
- Create: `scripts/create-user.ts`

### KV にテストユーザーを登録するスクリプト

**Step 1: スクリプトを作成**

`scripts/create-user.ts` を作成：

```ts
/**
 * 開発用ユーザー登録スクリプト
 * 使い方: npx wrangler kv key put --binding SESSION "users:admin" '{"passwordHash":"...","createdAt":"..."}' --preview
 *
 * または以下を参考に hash を手動生成してから wrangler CLI で登録する
 */

// パスワードハッシュを生成して出力するだけのスクリプト
async function main() {
  const username = process.argv[2] ?? "admin";
  const password = process.argv[3] ?? "password123";

  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const passwordHash = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

  const userData = JSON.stringify({
    passwordHash,
    createdAt: new Date().toISOString(),
  });

  console.log(`\nユーザー: ${username}`);
  console.log(`パスワード: ${password}`);
  console.log(`\n以下のコマンドで KV に登録してください:\n`);
  console.log(
    `npx wrangler kv key put --binding SESSION "users:${username}" '${userData}' --preview`
  );
}

main();
```

**Step 2: スクリプトを実行してユーザーを KV に登録**

```bash
node --experimental-vm-modules scripts/create-user.ts admin password123
```

出力されたコマンドを実行して KV にユーザーを登録する。

**Step 3: 全テストを実行**

```bash
pnpm test
```

Expected: PASS 全テスト

**Step 4: コミット**

```bash
git add scripts/create-user.ts
git commit -m "chore: add dev script for creating users in KV"
```

---

## 完了確認チェックリスト

```
- [ ] pnpm test が全 PASS
- [ ] pnpm astro check がエラーなし
- [ ] /dashboard → /login にリダイレクトされる
- [ ] 正しい認証情報でログインできる
- [ ] ログアウト後に /login にリダイレクトされる
- [ ] GET /api/me が認証済みでユーザー名を返す
- [ ] GET /api/me が未認証で 401 を返す
```
