import type { APIRoute } from "astro";
import { deleteSession } from "../../lib/kv";
import { json } from "../../lib/response";

export async function handleLogout(
  request: Request,
  kv: KVNamespace
): Promise<Response> {
  const cookieHeader = request.headers.get("Cookie") ?? "";
  const token = cookieHeader
    .split("; ")
    .find((c) => c.startsWith("session_token="))
    ?.slice("session_token=".length);

  if (token) {
    await deleteSession(kv, token);
  }

  return json({ ok: true }, 200, {
    "Set-Cookie":
      "session_token=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0",
  });
}

export const prerender = false;

export const POST = (async ({ request, locals }) => {
  return handleLogout(request, locals.runtime.env.SESSION);
}) satisfies APIRoute;
