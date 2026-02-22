import { defineMiddleware } from "astro:middleware";
import { getSession } from "./lib/kv";

export async function resolveSession(
  kv: KVNamespace,
  token: string | undefined
): Promise<{ username: string } | null> {
  if (!token) return null;

  // KV からセッションを取得
  const session = await getSession(kv, token);
  if (!session) return null;

  // セッション期限切れチェック
  if (Date.now() > session.expiresAt) {
    await kv.delete(`sessions:${token}`);
    return null;
  }

  return { username: session.username };
}

export const onRequest = defineMiddleware(async (context, next) => {
  // Cookie からセッショントークンを取得
  const token = context.cookies.get("session_token")?.value;
  const kv = context.locals.runtime.env.SESSION;

  // セッションを検証してユーザー情報をセット
  context.locals.user = await resolveSession(kv, token);

  return next();
});
