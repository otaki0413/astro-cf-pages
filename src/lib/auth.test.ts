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
    expect(token.length).toBeGreaterThanOrEqual(64);
  });

  it("呼び出しごとに異なる値を返す", () => {
    const token1 = generateToken();
    const token2 = generateToken();
    expect(token1).not.toBe(token2);
  });
});
