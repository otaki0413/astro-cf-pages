import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import { saveSession } from "../../lib/kv";
import { handleMe } from "../../pages/api/me";

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

  it("期限切れセッションで401を返す", async () => {
    const token = "me-expired-token";
    await saveSession(
      env.SESSION,
      token,
      { username: "dave", expiresAt: Date.now() - 1000 },
      60
    );

    const request = new Request("http://localhost/api/me", {
      headers: { Cookie: `session_token=${token}` },
    });

    const response = await handleMe(request, env.SESSION);
    expect(response.status).toBe(401);
  });
});
