const backend = "https://queencess-braids-studio.kwandabuso.chatgpt.site";
const functionPath = "/.netlify/functions/booking-api";

// Keep browser requests same-origin while reusing the persistent public demo backend.
export default async function handler(request) {
  const incoming = new URL(request.url);
  const route = incoming.pathname.startsWith(functionPath + "/")
    ? incoming.pathname.slice(functionPath.length)
    : incoming.pathname.slice("/api".length);
  const upstream = new URL(backend);
  upstream.pathname = "/api" + route;
  upstream.search = incoming.search;

  // Forward the owner session and JSON body without forwarding browser cookies.
  const headers = new Headers();
  for (const name of ["authorization", "content-type"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const { method } = request;
  const hasBody = method !== "GET" && method !== "HEAD" && request.body !== null;
  try {
    const response = await fetch(upstream, {
      method, headers, redirect: "manual",
      ...(hasBody ? { body: request.body, duplex: "half" } : {}),
    });
    return new Response(response.body, {
      status: response.status,
      headers: {
        "Content-Type": response.headers.get("content-type") || "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return Response.json({ error: "The booking service is temporarily unavailable." }, { status: 502 });
  }
}
