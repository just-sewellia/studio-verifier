// POST /api/resolve   body: { email, studio, town? }
// Runs the inbound-lead verification pipeline and returns every step it took.

const UA = "BoutiqueLeadVerifier/1.0 (portfolio demo)";
const VIEWBOX = "-76.90,39.55,-76.35,39.15"; // Baltimore metro

const FREEMAIL = new Set(["gmail.com", "googlemail.com", "yahoo.com", "hotmail.com", "outlook.com",
  "aol.com", "icloud.com", "me.com", "mac.com", "comcast.net", "verizon.net", "msn.com", "live.com",
  "protonmail.com", "proton.me", "ymail.com", "att.net", "gmx.com"]);

const NICK = { mike: "michael", chris: "christopher", kate: "katherine", katie: "katherine",
  jen: "jennifer", jenn: "jennifer", jenny: "jennifer", liz: "elizabeth", beth: "elizabeth",
  dan: "daniel", danny: "daniel", matt: "matthew", tom: "thomas", rob: "robert", bob: "robert",
  bill: "william", will: "william", sam: "samuel", alex: "alexander", nick: "nicholas",
  tony: "anthony", jim: "james", jimmy: "james", joe: "joseph", steve: "steven", dave: "david",
  ben: "benjamin", andy: "andrew", sue: "susan", becky: "rebecca", meg: "megan", pat: "patrick",
  ed: "edward", greg: "gregory", jon: "jonathan", josh: "joshua", tim: "timothy", vicky: "victoria" };

const FINGERPRINTS = [
  ["Zen Planner", "Daxko", /zenplanner\.com/i], ["SugarWOD", "Daxko", /sugarwod\.com/i],
  ["UpLaunch", "Daxko", /uplaunch\.com/i], ["Exercise.com", "Daxko", /\bexercise\.com/i],
  ["Club Automation", "Daxko", /clubautomation\.com/i], ["Daxko", "Daxko", /daxko\.com/i],
  ["Mindbody", "Competitor", /mindbodyonline\.com|healcode|mindbody\.io/i],
  ["Glofox", "Competitor", /glofox\.com/i], ["Wodify", "Competitor", /wodify\.com/i],
  ["PushPress", "Competitor", /pushpress\.com/i], ["Pike13", "Competitor", /pike13\.com/i],
  ["Momence", "Competitor", /momence\.com/i], ["WellnessLiving", "Competitor", /wellnessliving\.com/i],
  ["Walla", "Competitor", /hellowalla\.com/i], ["Arbox", "Competitor", /arboxapp\.com/i],
  ["Mariana Tek", "Competitor", /marianatek\.com/i], ["TeamUp", "Competitor", /goteamup\.com/i],
  ["Gymdesk", "Competitor", /gymdesk\.com/i], ["Spark Membership", "Competitor", /sparkmembership\.com/i],
  ["Kicksite", "Competitor", /kicksite\.(?:net|com)/i], ["ClubReady", "Competitor", /clubready\.com/i],
  ["Vagaro", "Competitor", /vagaro\.com/i], ["bsport", "Competitor", /bsport\.io/i],
  ["Punchpass", "Competitor", /punchpass\.com/i], ["Zingfit", "Competitor", /zingfit\.com/i],
  ["Acuity Scheduling", "General scheduler", /acuityscheduling\.com/i],
  ["Calendly", "General scheduler", /calendly\.com/i],
  ["Square", "General scheduler", /squareup\.com\/appointments|square\.site/i],
  ["Wix", "Site builder", /wixstatic\.com|wix\.com/i], ["Squarespace", "Site builder", /squarespace\.com|sqspcdn\.com/i],
  ["WordPress", "Site builder", /wp-content|wp-includes/i], ["GoDaddy Builder", "Site builder", /img1\.wsimg\.com/i],
  ["Weebly", "Site builder", /weebly\.com/i],
  ["HubSpot", "Marketing tool", /js\.hs-scripts\.com|hsforms/i], ["Mailchimp", "Marketing tool", /list-manage\.com|chimpstatic/i],
];

const OWNER_RE = /\b(co-?owners?|owners?|co-?founders?|founders?|founded by|owned (?:and operated )?by|proprietor)\b/gi;
const LEADER_RE = /\b(head instructor|chief instructor|head coach|lead instructor|studio director|program director|general manager|studio manager)\b/gi;
const STAFF_RE = /\b(instructors?|coach(?:es)?|teachers?|trainers?|staff)\b/gi;
const HONORIFIC_RE = /\b(Sensei|Master|Professor|Grandmaster|Sifu|Shihan|Kyoshi|Sabumnim|Hanshi|Renshi|Coach)\s+$/;
const TOK = "(?:[A-Z][a-z]*['’-]?[A-Z][a-z]+|[A-Z][a-z]+)";
const NAME_RE = new RegExp(`(?<![A-Za-z])(?=(${TOK})\\s+(?:[A-Z]\\.\\s+)?(${TOK})(?![A-Za-z]))`, "g");
const NOT_NAMES = new Set(`the our your meet about contact home black belt brazilian jiu jitsu martial arts yoga studio
pilates barre fitness gym academy center centre baltimore maryland head instructor coach owner founder director
master sensei professor grand kids adult adults class classes schedule free trial monday tuesday wednesday
thursday friday saturday sunday january february march april may june july august september october november
december read more learn sign up book now join today new welcome team staff program programs alliance certified
teacher training hot power vinyasa hatha yin kundalini ashtanga restorative krav maga muay thai tae kwon do kung
fu judo karate boxing kickboxing self defense personal group private online virtual policy privacy terms rights
reserved copyright powered street avenue road suite north south east west federal hill fells point canton hampden
mount vernon towson columbia inner harbor station united states world champion championship national
international olympic strength conditioning functional crossfit level certificate degree dan rank lineage
testimonials reviews google facebook instagram youtube gift card cards shop store member members membership login
register mind body soul spirit peace love community family wellness health healing holistic reiki meditation
breathwork sound bath retreat workshop workshops event events blog news faq pricing prices rates location
locations hours open closed parking directions map email phone call text us we my mr mrs ms dr miss gracie barra
studios inc llc co club fit athletics athletic performance mixed self little ninjas tigers dragons warriors lions
fundamentals advanced beginner beginners intermediate all levels st ave rd blvd ste get started view details
click here go back`.split(/\s+/));

// ------------------------------------------------------------------ helpers
const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

function normalize(s) {
  return (s || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ").replace(/tae\s*kwon\s*do/g, "taekwondo").replace(/[^a-z0-9]+/g, " ")
    .split(" ").filter(Boolean)
    .map(t => ({ bjj: "brazilian jiu jitsu", tkd: "taekwondo", jj: "jiu jitsu", ctr: "center" }[t] || t))
    .join(" ").split(" ").filter(t => !["the", "llc", "inc", "co", "and", "of"].includes(t)).join(" ");
}
function bigrams(s) { const g = new Map(); const x = s.replace(/ /g, ""); for (let i = 0; i < x.length - 1; i++) { const k = x.slice(i, i + 2); g.set(k, (g.get(k) || 0) + 1); } return g; }
function dice(a, b) {
  const A = bigrams(a), B = bigrams(b); let inter = 0, total = 0;
  for (const [k, v] of A) { inter += Math.min(v, B.get(k) || 0); total += v; }
  for (const v of B.values()) total += v;
  return total ? (2 * inter) / total : 0;
}
function similarity(a, b) {
  const x = normalize(a), y = normalize(b); if (!x || !y) return 0;
  const A = new Set(x.split(" ")), B = new Set(y.split(" "));
  const inter = [...A].filter(t => B.has(t)).length;
  const jac = inter / new Set([...A, ...B]).size;
  let s = 0.5 * jac + 0.5 * dice(x, y);
  if (x.includes(y) || y.includes(x)) s = Math.max(s, 0.85);
  return Math.round(s * 100) / 100;
}
function decodeEntities(s) {
  return s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
}
function htmlToText(html) {
  return decodeEntities(html.replace(/<(script|style|noscript|svg|template|iframe)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/?(br|p|li|h\d|div|section|tr)[^>]*>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}
function cfDecode(hex) { try { const k = parseInt(hex.slice(0, 2), 16); let o = ""; for (let i = 2; i < hex.length; i += 2) o += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ k); return o; } catch { return ""; } }
const BAD_EMAIL = /\.(png|jpe?g|gif|webp|svg|css|js)$|sentry|wixpress|example\.|domain\.com|email\.com|yourdomain|godaddy|squarespace|@2x|mysite/i;
function findEmails(html) {
  const out = new Set();
  for (const m of html.matchAll(/mailto:([^"'?>\s]+)/gi)) out.add(decodeURIComponent(m[1]).toLowerCase());
  for (const m of html.matchAll(/data-cfemail="([0-9a-f]+)"/gi)) out.add(cfDecode(m[1]).toLowerCase());
  for (const m of html.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) out.add(m[0].toLowerCase());
  return [...out].filter(e => e.includes("@") && !BAD_EMAIL.test(e));
}
function detectTech(blob) {
  const hits = [];
  for (const [platform, family, re] of FINGERPRINTS) {
    const m = blob.match(re);
    if (m) hits.push({ platform, family, evidence: blob.slice(Math.max(0, m.index - 50), m.index + m[0].length + 50).replace(/\s+/g, " ") });
  }
  return hits;
}
function nameCandidates(text) {
  const out = [];
  for (const m of text.matchAll(NAME_RE)) {
    const [a, b] = [m[1], m[2]];
    if (NOT_NAMES.has(a.toLowerCase()) || NOT_NAMES.has(b.toLowerCase())) continue;
    const end = text.indexOf(b, m.index + a.length) + b.length;
    out.push({ start: m.index, end, first: a, last: b, name: `${a} ${b}` });
  }
  return out;
}

// Role nearest to a name occurrence, skipping roles that clearly belong to someone else.
function roleNear(text, occ, allNames) {
  const lo = Math.max(0, occ.start - 140), hi = Math.min(text.length, occ.end + 140);
  const win = text.slice(lo, hi);
  const pre = text.slice(Math.max(0, occ.start - 16), occ.start);
  const hon = pre.match(HONORIFIC_RE);
  let best = null;
  const consider = (re, level, rank) => {
    for (const m of win.matchAll(re)) {
      const ks = lo + m.index, ke = ks + m[0].length;
      const dist = ks >= occ.end ? ks - occ.end : occ.start - ke;
      if (dist < 0) continue;
      // a title belongs to whichever name sits closest to it
      const distTo = n => ks >= n.end ? ks - n.end : (n.start >= ke ? n.start - ke : 0);
      const nearest = allNames.filter(n => Math.abs(n.start - occ.start) < 400)
        .reduce((a, n) => (!a || distTo(n) < distTo(a) ? n : a), null);
      if (nearest && nearest.start !== occ.start && distTo(nearest) < dist) continue;
      if (!best || rank > best.rank || (rank === best.rank && dist < best.dist))
        best = { level, keyword: m[0], dist, rank };
    }
  };
  consider(OWNER_RE, "owner", 3); consider(LEADER_RE, "leader", 2); consider(STAFF_RE, "staff", 1);
  if (hon && (!best || best.rank < 2)) best = { level: hon[1] === "Coach" ? "staff" : "leader", keyword: hon[1], dist: 0, rank: hon[1] === "Coach" ? 1 : 2 };
  return { ...(best || { level: "mentioned", keyword: null, rank: 0 }), snippet: text.slice(Math.max(0, occ.start - 100), occ.end + 100) };
}

function parseEmail(email) {
  const e = (email || "").trim().toLowerCase();
  const m = e.match(/^([^@\s]+)@([^@\s]+\.[a-z]{2,})$/);
  if (!m) return null;
  const local = m[1].split("+")[0];
  const parts = local.replace(/\d+/g, "").split(/[._-]+/).filter(Boolean);
  return { email: e, local, domain: m[2], freemail: FREEMAIL.has(m[2]), parts, squashed: parts.join("") };
}

// Does the inbound address look like it belongs to this person?
function emailMatchesPerson(pe, first, last) {
  const f0 = first.toLowerCase().replace(/[^a-z]/g, ""), l = last.toLowerCase().replace(/[^a-z]/g, "");
  const firsts = new Set([f0, NICK[f0]].filter(Boolean));
  for (const [k, v] of Object.entries(NICK)) if (v === f0) firsts.add(k);
  const s = pe.squashed;
  for (const f of firsts) {
    if (s === f + l || s === l + f) return { strength: 3, pattern: "first + last name" };
    if (s === f[0] + l || s === l + f[0]) return { strength: 2, pattern: "initial + surname" };
    if (s === f + l[0]) return { strength: 2, pattern: "first name + initial" };
  }
  if (l.length >= 4 && s.includes(l) && [...firsts].some(f => s.includes(f))) return { strength: 2, pattern: "name inside a longer handle" };
  if (s === l && l.length >= 4) return { strength: 1, pattern: "surname only" };
  if (firsts.has(s) && s.length >= 3) return { strength: 1, pattern: "first name only" };
  return null;
}

// ------------------------------------------------------------- live lookups
async function timedFetch(url, ms = 7000, headers = {}) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { headers: { "user-agent": UA, ...headers }, signal: ctl.signal, redirect: "follow" }); }
  finally { clearTimeout(t); }
}
async function robotsAllows(url) {
  try {
    const u = new URL(url); const r = await timedFetch(`${u.origin}/robots.txt`, 4000);
    if (!r.ok) return true;
    const lines = (await r.text()).split(/\r?\n/); let applies = false; const dis = [];
    for (const raw of lines) {
      const line = raw.split("#")[0].trim(); const [k, ...rest] = line.split(":"); const v = rest.join(":").trim();
      if (/^user-agent$/i.test(k)) applies = v === "*" || /BoutiqueLeadVerifier/i.test(v);
      else if (applies && /^disallow$/i.test(k) && v) dis.push(v);
    }
    return !dis.some(p => u.pathname.startsWith(p));
  } catch { return true; }
}
async function nominatim(q) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&extratags=1&addressdetails=1&limit=6&bounded=1&viewbox=${VIEWBOX}&q=${encodeURIComponent(q)}`;
  const r = await timedFetch(url, 7000, { "accept-language": "en" });
  return r.ok ? r.json() : [];
}
async function liveRead(site) {
  if (!site) return { status: "no website listed" };
  const host = new URL(site).hostname;
  if (/facebook|instagram|linktr\.ee|yelp|google\./i.test(host)) return { status: "social page only (not readable without login)" };
  if (!(await robotsAllows(site))) return { status: "blocked by robots.txt" };
  const r = await timedFetch(site); if (!r.ok) return { status: `HTTP ${r.status}` };
  const html = (await r.text()).slice(0, 400000); const finalUrl = r.url || site;
  const root = new URL(finalUrl).hostname.replace(/^www\./, "");
  const links = [];
  for (const m of html.matchAll(/<a[^>]+href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let u; try { u = new URL(m[1], finalUrl); } catch { continue; }
    if (u.hostname.replace(/^www\./, "") !== root) continue;
    if (/about|team|staff|instructor|coach|owner|meet|story|founder|faculty|teacher|contact|bio|leadership/i.test(u.pathname + " " + m[2]))
      if (!links.includes(u.href) && u.href.replace(/\/$/, "") !== finalUrl.replace(/\/$/, "")) links.push(u.href);
  }
  const extra = await Promise.all(links.slice(0, 3).map(async u => {
    try { const x = await timedFetch(u, 6000); return x.ok ? { url: x.url || u, html: (await x.text()).slice(0, 300000) } : null; } catch { return null; }
  }));
  const all = [{ url: finalUrl, html }, ...extra.filter(Boolean)];
  const emails = []; for (const p of all) for (const e of findEmails(p.html)) emails.push({ email: e, page: p.url });
  return {
    status: "read", crawled_at: new Date().toISOString(), domain: root, live: true,
    pages: all.map(p => ({ url: p.url, text: htmlToText(p.html).slice(0, 12000) })),
    emails, tech: detectTech(finalUrl + "\n" + all.map(p => p.html).join("\n")),
  };
}

// ----------------------------------------------------------------- pipeline
export async function onRequestPost({ request, env }) {
  let body; try { body = await request.json(); } catch { return json({ error: "Send JSON: {email, studio}" }, 400); }
  const trace = []; const t0 = Date.now(); let tick = Date.now();
  const step = (title, status, detail, evidence = []) => { const now = Date.now(); trace.push({ title, status, detail, evidence, ms: now - tick }); tick = now; };

  // 1. Parse the inbound address
  const pe = parseEmail(body.email);
  if (!pe) return json({ error: "That email address doesn't look valid." }, 400);
  if (!body.studio || body.studio.trim().length < 3) return json({ error: "Add the studio name the lead gave." }, 400);
  step("Read the inbound address", "done",
    pe.freemail ? `${pe.domain} is a personal mailbox, so the domain can't identify the business. Name tokens found: ${pe.parts.join(", ") || "none"}.`
                : `${pe.domain} is a business domain. It can be checked directly against studio websites.`,
    [{ label: "Handle", value: pe.local }, { label: "Domain type", value: pe.freemail ? "Personal (free mail)" : "Business" }]);

  // 2. Match the studio
  let seed = { studios: [] };
  try { const r = await env.ASSETS.fetch(new URL("/data/seed.json", request.url)); if (r.ok) seed = await r.json(); } catch {}
  const town = (body.town || "").toLowerCase();
  let ranked = seed.studios.map(s => {
    let score = similarity(body.studio, s.name);
    if (!pe.freemail && s.crawl?.domain && pe.domain.endsWith(s.crawl.domain)) score = 1;
    if (town && (s.address || "").toLowerCase().includes(town)) score = Math.min(1, score + 0.05);
    return { s, score };
  }).sort((a, b) => b.score - a.score);
  let studio = null, matchScore = 0, matchMethod = "";
  if (ranked[0] && ranked[0].score >= 0.55) {
    studio = ranked[0].s; matchScore = ranked[0].score; matchMethod = "studio index";
  } else {
    try {
      const hits = await nominatim(`${body.studio} ${body.town || "Baltimore"}`);
      const scored = hits.map(h => ({ h, score: similarity(body.studio, h.name || h.display_name) })).sort((a, b) => b.score - a.score);
      const top = scored[0];
      if (top && top.score >= 0.5) {
        const h = top.h, a = h.address || {}, x = h.extratags || {};
        let site = x.website || x["contact:website"] || ""; if (site && !/^https?:/i.test(site)) site = "https://" + site;
        studio = { id: `osm-live-${h.osm_type}-${h.osm_id}`, name: h.name || body.studio, category: "Not classified",
          address: [a.house_number, a.road, a.city || a.town || a.village, a.postcode].filter(Boolean).join(" "),
          phone: x.phone || x["contact:phone"] || "", website: site, osm_url: `https://www.openstreetmap.org/${h.osm_type}/${h.osm_id}` };
        matchScore = top.score; matchMethod = "live OpenStreetMap search";
      }
    } catch {}
  }
  if (!studio) {
    step("Match the studio", "stopped", `No studio in Baltimore matched “${body.studio}” closely enough.`,
      ranked.slice(0, 3).map(r => ({ label: r.s.name, value: `similarity ${r.score}` })));
    return json({ trace, verdict: { status: "Not verified", score: 0, routing: "Hold for manual research. Do not create or associate an account record." }, record: [], ms: Date.now() - t0 });
  }
  step("Match the studio", matchScore >= 0.7 ? "done" : "weak",
    `Best match is ${studio.name} via ${matchMethod} (similarity ${matchScore}).`,
    matchMethod === "studio index" ? ranked.slice(0, 3).map(r => ({ label: r.s.name, value: `similarity ${r.score}` })) : [{ label: "Source", value: studio.osm_url }]);

  // 3. Website / domain
  let crawl = studio.crawl;
  if (!crawl || crawl.status !== "read") {
    if (!crawl || matchMethod !== "studio index") { try { crawl = await liveRead(studio.website); } catch (e) { crawl = { status: "could not read site" }; } }
  }
  const domain = crawl?.domain || (studio.website ? new URL(studio.website).hostname.replace(/^www\./, "") : "");
  step("Confirm the studio's domain", domain ? "done" : "stopped",
    domain ? `Official site is ${domain}. This is the domain the contact's personal address can't supply.` : "This studio has no website on record, so there's no domain to attach.",
    [{ label: "Website", value: studio.website || "none" }, { label: "Map record", value: studio.osm_url }]);

  // 4. Read the site
  const pages = crawl?.pages || [];
  step("Read the studio's public pages", crawl?.status === "read" ? "done" : "stopped",
    crawl?.status === "read" ? `Read ${pages.length} page${pages.length === 1 ? "" : "s"} ${crawl.live ? "just now" : (crawl.crawled_at ? `from the index (captured ${crawl.crawled_at.slice(0, 10)})` : "from the index")}.` : `Couldn't read the site: ${crawl?.status || "unknown"}.`,
    pages.map(p => ({ label: "Page", value: p.url })));

  // 5. Tech stack
  const tech = crawl?.tech || [];
  const booking = tech.filter(t => ["Daxko", "Competitor", "General scheduler"].includes(t.family));
  const builder = tech.find(t => t.family === "Site builder");
  step("Detect booking software", booking.length ? "done" : "weak",
    booking.length ? `Found ${booking.map(b => `${b.platform} (${b.family === "Daxko" ? "Daxko family" : b.family.toLowerCase()})`).join(", ")}.`
                   : "No booking platform visible on the pages read. It may sit behind a login or an app link.",
    [...booking, ...(builder ? [builder] : [])].map(t => ({ label: t.platform, value: t.evidence })));

  // 6. Validate the person
  const signals = []; let best = null;
  if (crawl?.status === "read") {
    const published = (crawl.emails || []).find(e => e.email === pe.email);
    if (published) signals.push({ label: "This exact address is published on the studio's own website", points: 45, evidence: published.page });
    if (!pe.freemail) {
      if (domain && pe.domain.endsWith(domain)) signals.push({ label: "Email domain matches the studio's website", points: 40, evidence: domain });
      else signals.push({ label: "Business email domain doesn't match the studio's site", points: -10, evidence: pe.domain });
    }
    for (const p of pages) {
      const names = nameCandidates(p.text);
      for (const occ of names) {
        const em = emailMatchesPerson(pe, occ.first, occ.last); if (!em) continue;
        const role = roleNear(p.text, occ, names);
        const cand = { ...occ, ...em, role, page: p.url };
        const rank = c => c.strength * 10 + c.role.rank;
        if (!best || rank(cand) > rank(best)) best = cand;
      }
    }
    if (best) {
      const pts = { owner: 75, leader: 60, staff: 25, mentioned: 15 }[best.role.level] * (best.strength === 3 ? 1 : best.strength === 2 ? 0.85 : 0.4);
      signals.push({ label: `Address matches ${best.name} (${best.pattern}), named on the site as ${best.role.keyword ? `“${best.role.keyword}”` : "a person with no stated role"}`,
        points: Math.round(pts), evidence: best.page, snippet: best.role.snippet, highlight: best.name });
    } else if (pe.parts.length) {
      signals.push({ label: "No one on the studio's pages matches the name in this address", points: 0, evidence: pages.map(p => p.url).join(" ") });
    }
    const others = (crawl.emails || []).filter(e => e.email !== pe.email).length;
    if (others && !published) signals.push({ label: `The studio publishes ${others} other contact address${others > 1 ? "es" : ""}`, points: 0, evidence: "Informational: the lead may be using a personal inbox instead." });
  }
  let score = signals.reduce((a, s) => a + s.points, 0);
  if (matchScore < 0.7) { score *= 0.8; signals.push({ label: "Studio match was weak, so the score is reduced", points: 0, evidence: `similarity ${matchScore}` }); }
  score = Math.max(0, Math.min(100, Math.round(score)));
  step("Check the person against the studio", score >= 40 ? "done" : "weak",
    best ? `Strongest evidence: ${best.name}, ${best.role.level === "mentioned" ? "named without a role" : best.role.level + "-level role"}.` : "No person-level evidence found.",
    signals.map(s => ({ label: s.label, value: s.points > 0 ? `+${s.points}` : String(s.points), snippet: s.snippet, highlight: s.highlight, source: s.evidence })));

  // 7. Verdict + routing
  const verdict = score >= 70
    ? { status: "Verified decision-maker", routing: "Associate to the studio's account and route to the boutique SDR sequence." }
    : score >= 40
    ? { status: "Likely affiliated", routing: "Associate with a review flag. SDR confirms role on first touch." }
    : { status: "Not verified", routing: "Don't auto-associate. Send to the enrichment review queue." };
  if (score < 70 && best && best.role.level === "staff" && best.strength >= 2)
    Object.assign(verdict, { status: "Staff, not a decision-maker", routing: "Associate as an influencer contact. Look for the owner before routing to sales." });
  verdict.score = score;
  step("Score and route", "done", `${verdict.status} (${score}/100). ${verdict.routing}`);

  const now = new Date().toISOString();
  const bk = booking[0];
  const record = [
    ["Email", pe.email, "Inbound form", "Given"],
    ["Email type", pe.freemail ? "Personal mailbox" : "Business domain", "Parsed", "High"],
    ["First name", best ? best.first : (pe.parts[0] || ""), best ? "Studio website" : "Parsed from email", best ? "High" : "Low"],
    ["Last name", best ? best.last : (pe.parts[1] || ""), best ? "Studio website" : "Parsed from email", best ? "High" : "Low"],
    ["Role", best?.role.keyword || "Unknown", best ? "Studio website" : "None", best?.role.rank >= 2 ? "High" : "Low"],
    ["Company", studio.name, "OpenStreetMap", matchScore >= 0.7 ? "High" : "Medium"],
    ["Company domain", domain || "None", "OpenStreetMap + website", domain ? "High" : "None"],
    ["Business phone", studio.phone || "None listed", "OpenStreetMap", studio.phone ? "Medium" : "None"],
    ["Address", studio.address || "None listed", "OpenStreetMap", studio.address ? "Medium" : "None"],
    ["Segment", `Boutique: ${studio.category}`, "Category rules", "Medium"],
    ["Location count", "1", "Chain and duplicate filter", "Medium"],
    ["Booking platform", bk ? bk.platform : "Not detected", "Website code", bk ? "High" : "None"],
    ["Platform family", bk ? (bk.family === "Daxko" ? "Daxko family" : bk.family) : "Unknown", "Website code", bk ? "High" : "None"],
    ["Site builder", builder?.platform || "Unknown", "Website code", builder ? "High" : "None"],
    ["Verification status", verdict.status, "This check", "—"],
    ["Verification score", String(score), "This check", "—"],
    ["Evidence URL", best?.page || "None", "This check", "—"],
    ["SMS consent", "Unknown. Do not text.", "Default", "—"],
    ["Verified at", now, "This check", "—"],
  ].map(([field, value, source, confidence]) => ({ field, value, source, confidence }));

  return json({ trace, verdict, record, studio: { name: studio.name, id: studio.id }, ms: Date.now() - t0 });
}

export async function onRequestGet() {
  return json({ usage: "POST JSON {email, studio, town?} to this endpoint." });
}
