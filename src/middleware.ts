import { defineMiddleware } from "astro:middleware";
import { getSession } from "./lib/kv";

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
