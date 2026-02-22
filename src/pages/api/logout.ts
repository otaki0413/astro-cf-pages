import type { APIRoute } from "astro";
import { deleteSession } from "../../lib/kv";

export async function handleLogout(
  request: Request,
  kv: KVNamespace
): Promise<Response> {
  const cookieHeader = request.headers.get("Cookie") ?? "";
  const match = cookieHeader.match(/session_token=([^;]+)/);
  const token = match?.[1];

  if (token) {
    await deleteSession(kv, token);
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie":
        "session_token=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0",
    },
  });
}

export const prerender = false;

export const POST: APIRoute = async (context) => {
  return handleLogout(context.request, context.locals.runtime.env.SESSION);
};
