// Serves the page, plus one live endpoint: /api/fetch
// It fetches a studio's public web page and passes it back untouched. All matching happens in the browser.

const UA = "BoutiqueLeadVerifier/1.0 (portfolio demo)";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/fetch") {
      if (request.method === "POST") return proxy(request);
      return new Response(JSON.stringify({ ok: true, proxy: "running" }), {
        headers: { "content-type": "application/json", "x-proxy": "1", "cache-control": "no-store" },
      });
    }
    return env.ASSETS.fetch(request);
  },
};

async function proxy(request) {
  let q;
  try { q = await request.json(); } catch { return new Response("Send JSON {url}", { status: 400 }); }
  let target;
  try { target = new URL(q.url); } catch { return new Response("Bad url", { status: 400 }); }
  if (!/^https?:$/.test(target.protocol)) return new Response("Only http(s) pages", { status: 400 });

  const headers = { "user-agent": UA, accept: "text/html,application/json;q=0.9,*/*;q=0.5" };
  for (const k of ["content-type", "accept-language"]) if (q.headers?.[k]) headers[k] = q.headers[k];
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(target.href, {
      method: q.method === "POST" ? "POST" : "GET",
      body: q.method === "POST" ? q.body : undefined,
      headers, redirect: "follow", signal: ctl.signal,
    });
    return new Response(r.body, {
      status: 200,
      headers: {
        "x-proxy": "1",
        "x-upstream-status": String(r.status),
        "x-upstream-type": r.headers.get("content-type") || "",
        "x-final-url": r.url || target.href,
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  } catch {
    return new Response("", { status: 200, headers: { "x-proxy": "1", "x-upstream-status": "599", "x-final-url": target.href } });
  } finally {
    clearTimeout(timer);
  }
}
