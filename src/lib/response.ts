export const json = (
  data: unknown,
  status = 200,
  extraHeaders?: Record<string, string>
): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...extraHeaders,
    },
  });
