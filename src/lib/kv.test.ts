import { describe, it, expect } from "vitest";
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
