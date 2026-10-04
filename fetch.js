// POST /api/fetch  { url, method?, body?, headers? }
// Fetches one public web page and streams it straight back. No parsing happens here,
// so it stays far inside Cloudflare's free-tier compute limit; the page does the matching.

const UA = "BoutiqueLeadVerifier/1.0 (portfolio demo)";
const PASS_HEADERS = ["content-type", "accept-language"];

export async function onRequestPost({ request }) {
  let q;
  try { q = await request.json(); } catch { return new Response("Send JSON {url}", { status: 400 }); }
  let target;
  try { target = new URL(q.url); } catch { return new Response("Bad url", { status: 400 }); }
  if (!/^https?:$/.test(target.protocol)) return new Response("Only http(s) pages", { status: 400 });

  const headers = { "user-agent": UA, accept: "text/html,application/json;q=0.9,*/*;q=0.5" };
  for (const k of PASS_HEADERS) if (q.headers?.[k]) headers[k] = q.headers[k];
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
  } catch (e) {
    return new Response("", { status: 200, headers: { "x-proxy": "1", "x-upstream-status": "599", "x-final-url": target.href } });
  } finally {
    clearTimeout(timer);
  }
}

export async function onRequestGet() {
  return new Response(JSON.stringify({ ok: true, proxy: "running" }), {
    headers: { "content-type": "application/json", "x-proxy": "1", "cache-control": "no-store" },
  });
}
