import { describe, it, expect } from "vitest";
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
