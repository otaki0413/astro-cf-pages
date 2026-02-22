import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { saveUser } from "../../lib/kv";
import { hashPassword } from "../../lib/auth";
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
