import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import { saveSession, getSession } from "./lib/kv";
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

  it("期限切れセッションはnullを返しKVから削除される", async () => {
    const token = "expired-token";
    // KV TTL は最小60秒が必要。expiresAt を過去にすることで期限切れを表現する
    await saveSession(
      env.SESSION,
      token,
      { username: "bob", expiresAt: Date.now() - 1000 },
      60
    );

    const user = await resolveSession(env.SESSION, token);
    expect(user).toBeNull();

    // KV から削除されたことを確認
    const remaining = await getSession(env.SESSION, token);
    expect(remaining).toBeNull();
  });
});
