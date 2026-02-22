import type { APIRoute } from "astro";
import { z } from "zod";
import { getUser, saveSession } from "../../lib/kv";
import { verifyPassword, generateToken } from "../../lib/auth";
import { json } from "../../lib/response";

const SESSION_TTL = 60 * 60 * 24; // 24時間（秒）

const LoginSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1),
});

export async function handleLogin(
  request: Request,
  kv: KVNamespace
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const result = LoginSchema.safeParse(body);
  if (!result.success) {
    return json({ error: "username and password are required" }, 400);
  }

  const { username, password } = result.data;

  const user = await getUser(kv, username);
  if (!user) {
    return json({ error: "ユーザー名またはパスワードが違います" }, 401);
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    return json({ error: "ユーザー名またはパスワードが違います" }, 401);
  }

  const token = generateToken();
  await saveSession(
    kv,
    token,
    { username, expiresAt: Date.now() + SESSION_TTL * 1000 },
    SESSION_TTL
  );

  return json({ ok: true }, 200, {
    "Set-Cookie": `session_token=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_TTL}`,
  });
}

export const prerender = false;

export const POST = (async ({request, locals}) => {
  return handleLogin(request, locals.runtime.env.SESSION);
}) satisfies APIRoute;
