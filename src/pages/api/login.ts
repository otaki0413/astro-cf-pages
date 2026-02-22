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

  const USERNAME_MAX = 64;
  if (username.length === 0 || username.length > USERNAME_MAX) {
    return new Response(
      JSON.stringify({ error: "username and password are required" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

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
  return handleLogin(context.request, context.locals.runtime.env.SESSION);
};
