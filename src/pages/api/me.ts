import type { APIRoute } from "astro";
import { getSession } from "../../lib/kv";

export async function handleMe(
  request: Request,
  kv: KVNamespace
): Promise<Response> {
  const cookieHeader = request.headers.get("Cookie") ?? "";
  const match = cookieHeader.match(/session_token=([^;]+)/);
  const token = match?.[1];

  if (!token) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const session = await getSession(kv, token);
  if (!session || Date.now() > session.expiresAt) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ username: session.username }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

export const prerender = false;

export const GET: APIRoute = async (context) => {
  return handleMe(context.request, context.locals.runtime.env.SESSION);
};
