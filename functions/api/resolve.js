// POST /api/resolve   body: { email, studio?, town? }
//
// Flow
//   1. Classify the address
//        business domain ............ the domain is the studio's site (studio name not needed)
//        personal mailbox, studio-like handle (mdsbestkarate@) ... read the studio from the handle
//        personal mailbox, person-like handle (sandra.jenkins@) ... studio name required
//        business domain that isn't a studio (an employer) ......... studio name required
//   2. Identify the studio  3. Check its website is still theirs  4. Read people pages
//   5. Classify the account  6. Check the person  7. Route

const UA = "BoutiqueLeadVerifier/1.0 (portfolio demo)";
const VIEWBOX = "-76.90,39.55,-76.35,39.15";

const FREEMAIL = new Set(["gmail.com", "googlemail.com", "yahoo.com", "hotmail.com", "outlook.com", "aol.com",
  "icloud.com", "me.com", "mac.com", "comcast.net", "verizon.net", "msn.com", "live.com", "protonmail.com",
  "proton.me", "ymail.com", "att.net", "gmx.com"]);
const ROLE_LOCAL = /^(info|hello|hi|contact|contactus|support|admin|office|frontdesk|team|studio|gym|mail|inquiries|inquiry|enquiries|booking|bookings|book|membership|members|sales|billing|accounts|help|desk|questions|general|join|classes|schedule|events|programs?|register|registration|reception|welcome|connect|community)$/;

const NICK = { mike: "michael", chris: "christopher", kate: "katherine", katie: "katherine", jen: "jennifer",
  jenn: "jennifer", jenny: "jennifer", liz: "elizabeth", beth: "elizabeth", dan: "daniel", danny: "daniel",
  matt: "matthew", tom: "thomas", rob: "robert", bob: "robert", bill: "william", will: "william", sam: "samuel",
  alex: "alexander", nick: "nicholas", tony: "anthony", jim: "james", jimmy: "james", joe: "joseph",
  steve: "steven", dave: "david", ben: "benjamin", andy: "andrew", sue: "susan", becky: "rebecca", meg: "megan",
  pat: "patrick", ed: "edward", greg: "gregory", jon: "jonathan", josh: "joshua", tim: "timothy", ken: "kenneth",
  jeff: "jeffrey", rich: "richard", rick: "richard", ron: "ronald", don: "donald", abby: "abigail",
  maggie: "margaret", cathy: "catherine", kathy: "katherine" };
const firstVariants = f => { const s = new Set([f]); if (NICK[f]) s.add(NICK[f]); for (const [k, v] of Object.entries(NICK)) if (v === f || v === NICK[f]) s.add(k); return s; };

const FINGERPRINTS = [
  ["Zen Planner", "Daxko", /zenplanner\.com/i],
  ["SugarWOD", "Daxko", /sugarwod\.com/i],
  ["UpLaunch", "Daxko", /uplaunch\.com/i],
  ["Exercise.com", "Daxko", /\bexercise\.com/i],
  ["Club Automation", "Daxko", /clubautomation\.com/i],
  ["GroupEx Pro", "Daxko", /groupexpro\.com/i],
  ["Daxko Operations", "Daxko", /daxko\.com/i],
  ["Mindbody", "Competitor", /mindbodyonline\.com|healcode|mindbody\.io|brandedweb/i],
  ["Glofox", "Competitor", /glofox\.com/i],
  ["Wodify", "Competitor", /wodify\.com/i],
  ["PushPress", "Competitor", /pushpress\.com/i],
  ["Pike13", "Competitor", /pike13\.com/i],
  ["Momence", "Competitor", /momence\.com/i],
  ["WellnessLiving", "Competitor", /wellnessliving\.com/i],
  ["Walla", "Competitor", /hellowalla\.com/i],
  ["Arbox", "Competitor", /arboxapp\.com/i],
  ["Mariana Tek", "Competitor", /marianatek\.com/i],
  ["TeamUp", "Competitor", /goteamup\.com/i],
  ["Gymdesk", "Competitor", /gymdesk\.com/i],
  ["Spark Membership", "Competitor", /sparkmembership\.com/i],
  ["Kicksite", "Competitor", /kicksite\.(?:net|com)/i],
  ["ClubReady", "Competitor", /clubready\.com/i],
  ["Jackrabbit", "Competitor", /jackrabbitclass\.com/i],
  ["Vagaro", "Competitor", /vagaro\.com/i],
  ["bsport", "Competitor", /bsport\.io/i],
  ["Punchpass", "Competitor", /punchpass\.com/i],
  ["Zingfit", "Competitor", /zingfit\.com/i],
  ["ABC Glofox / ABC Ignite", "Competitor", /abcfitness\.com/i],
  ["Wix Bookings", "Built-in booking", /\/booking-calendar\/|\/service-page\/|\/pricing-plans\//i],
  ["Acuity / Squarespace Scheduling", "Built-in booking", /acuityscheduling\.com/i],
  ["Square Appointments", "Built-in booking", /squareup\.com\/appointments|square\.site/i],
  ["Calendly", "Built-in booking", /calendly\.com/i],
  ["ClassPass", "Marketplace", /classpass\.com/i],
  ["GoHighLevel", "Marketing", /reputationhub\.site|leadconnectorhq\.com|msgsndr\.com|gohighlevel/i],
  ["HubSpot", "Marketing", /js\.hs-scripts\.com|hsforms|hs-analytics/i],
  ["Mailchimp", "Marketing", /list-manage\.com|chimpstatic/i],
  ["Klaviyo", "Marketing", /klaviyo\.com/i],
  ["Constant Contact", "Marketing", /constantcontact\.com|ctctcdn\.com/i],
  ["ActiveCampaign", "Marketing", /activehosted\.com|activecampaign/i],
  ["Meta Pixel", "Analytics", /fbevents\.js|fbq\(/i],
  ["Google Analytics", "Analytics", /googletagmanager\.com\/gtag|google-analytics\.com|gtag\(/i],
  ["Google Tag Manager", "Analytics", /googletagmanager\.com\/gtm\.js/i],
  ["Wix", "Site builder", /wixstatic\.com|Wix\.com Website Builder/i],
  ["Squarespace", "Site builder", /squarespace\.com|squarespace-cdn\.com|sqspcdn\.com/i],
  ["WordPress", "Site builder", /wp-content|wp-includes/i],
  ["GoDaddy Builder", "Site builder", /img1\.wsimg\.com/i],
  ["Weebly", "Site builder", /weebly\.com/i],
  ["Webflow", "Site builder", /webflow\.com|website-files\.com/i],
];

const OWNER_RE = /\b(co-?owners?|owners?|co-?founders?|founders?|founded by|owned (?:and operated )?by|proprietor|executive director|(?<!vice )president|ceo|chief executive)\b/gi;
const LEADER_RE = /\b(head instructor|chief instructor|head coach|lead instructor|studio director|program director|managing director|general manager|studio manager|manager|board chair|chair(?:man|woman|person)?(?! yoga)|vice president|treasurer|board member|trustee|joined the [\w ]{0,20}board|on the board|director)\b/gi;
const STAFF_RE = /\b(instructors?|coach(?:es)?|teachers?|trainers?|staff|tutors?)\b/gi;
const HONORIFIC_RE = /\b(Sensei|Master|Professor|Grandmaster|Sifu|Shihan|Kyoshi|Sabumnim|Hanshi|Renshi|Coach)\s+$/;
const WORD_RE = /[A-Za-z][A-Za-z'’]*(?:-[A-Za-z][A-Za-z'’]*)?/g;
const NOT_NAMES = new Set(`the our your meet about contact home black belt brazilian jiu jitsu martial arts yoga studio
pilates barre fitness gym academy center centre baltimore maryland head instructor coach owner founder director
master sensei professor grand kids adult adults class classes schedule free trial monday tuesday wednesday thursday
friday saturday sunday january february march april may june july august september october november december read
more learn sign up book now join today new welcome team staff program programs alliance certified teacher training
hot power vinyasa hatha yin kundalini ashtanga restorative krav maga muay thai tae kwon do kung fu judo karate boxing
kickboxing self defense personal group private online virtual policy privacy terms rights reserved copyright powered
street avenue road suite north south east west federal hill fells point canton hampden mount vernon towson columbia
inner harbor station united states world champion championship national international olympic strength
conditioning functional crossfit level certificate degree dan rank lineage testimonials reviews google facebook
instagram youtube gift card cards shop store member members membership login register mind body soul spirit peace
love community family wellness health healing holistic reiki meditation breathwork sound bath retreat workshop
workshops event events blog news faq pricing prices rates location locations hours open closed parking directions
map email phone call text us we my mr mrs ms dr miss gracie barra studios inc llc co club fit athletics athletic
performance mixed self little ninjas tigers dragons warriors lions fundamentals advanced beginner beginners
intermediate all levels st ave rd blvd ste get started view details click here go back esquire esq cpa phd jr sr
senior vice chief officer development company university college high school group design theory board
partnerships press support menu directors operation accounting partner partners president executive manager
associates foundation youth city county state ceo cfo coo blue green brown purple red yellow orange gray grey white`.split(/\s+/));

const GENERIC = new Set(`yoga studio studios boxing center centre fitness gym academy karate martial arts art the of and
baltimore md crossfit pilates barre dojo school club training jiu jitsu bjj mma kickboxing taekwondo judo kung fu
muay thai self defense athletics athletic performance power hot house co llc inc program`.split(/\s+/));
const ABBR = { maryland: ["md"], baltimore: ["bmore", "balt", "bmo"], crossfit: ["cf"], taekwondo: ["tkd"],
  center: ["ctr"], centre: ["ctr"], brazilian: ["br"], academy: ["acad"], fitness: ["fit"], saint: ["st"],
  mount: ["mt"], and: ["n"], training: ["train"], boxing: ["box"], athletics: ["athletic"], strength: ["str"] };

const PARKED = /domain (?:is )?for sale|buy this domain|this domain may be for sale|parked free|sedoparking|hugedomains|dan\.com|afternic|domain has expired|\b(?:casino|slot gacor|togel|judi|situs|betting|viagra|payday loan|escort)\b/i;
const FITNESS_HINT = /yoga|pilates|barre|boxing|karate|martial|jiu|bjj|crossfit|taekwondo|judo|kung fu|muay|krav|dojo|gym|fitness|class schedule|free trial|instructor/i;
const DIRECTORY = /facebook\.|instagram\.|yelp\.|mapquest\.|yellowpages\.|classpass\.|mindbody|tripadvisor\.|bbb\.org|linkedin\.|groupon\.|nextdoor\.|google\.|bing\.|apple\.com|foursquare\.|manta\.com|chamberofcommerce|wikipedia\.|twitter\.|tiktok\.|youtube\.|duckduckgo\./i;

// ------------------------------------------------------------------ text utils
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const squash = s => (s || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
const words = s => (s || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/['’]/g, "").replace(/&/g, " and ").replace(/tae\s*kwon\s*do/g, "taekwondo").split(/[^a-z0-9]+/).filter(Boolean);
const regDomain = host => (host || "").toLowerCase().replace(/^www\./, "");
const hostOf = u => { try { return regDomain(new URL(u).hostname); } catch { return ""; } };
function decodeEntities(s) { return s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;|&rsquo;|&lsquo;|&#8217;/g, "’").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)); }
function htmlToText(html) { return decodeEntities(html.replace(/<img[^>]*\balt=["']([^"']*)["'][^>]*>/gi, " $1 ").replace(/<(script|style|noscript|svg|template|iframe)[\s\S]*?<\/\1>/gi, " ").replace(/<\/?(br|p|li|h\d|div|section|tr|header|footer)[^>]*>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim(); }
const metaName = html => (html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)/i) || html.match(/<title[^>]*>([^<]+)/i) || [])[1]?.replace(/\s*[|–—-]\s*(home|welcome).*$/i, "").replace(/^(home|welcome)\s*[|–—-]\s*/i, "").trim() || "";
function cfDecode(hex) { try { const k = parseInt(hex.slice(0, 2), 16); let o = ""; for (let i = 2; i < hex.length; i += 2) o += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ k); return o; } catch { return ""; } }
const BAD_EMAIL = /\.(png|jpe?g|gif|webp|svg|css|js)$|sentry|wixpress|example\.|domain\.com|email\.com|yourdomain|godaddy|squarespace|@2x|mysite/i;
function findEmails(html) {
  const out = new Set();
  for (const m of html.matchAll(/mailto:([^"'?>\s]+)/gi)) { try { out.add(decodeURIComponent(m[1]).toLowerCase()); } catch {} }
  for (const m of html.matchAll(/data-cfemail="([0-9a-f]+)"/gi)) out.add(cfDecode(m[1]).toLowerCase());
  for (const m of html.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) out.add(m[0].toLowerCase());
  return [...out].filter(e => e.includes("@") && !BAD_EMAIL.test(e));
}
function detectTech(blob) {
  const hits = [];
  for (const [platform, family, re] of FINGERPRINTS) { const m = blob.match(re); if (m) hits.push({ platform, family, evidence: blob.slice(Math.max(0, m.index - 50), m.index + m[0].length + 50).replace(/\s+/g, " ") }); }
  return hits;
}

// ------------------------------------------------------------ studio matching
function nameSimilarity(a, b) {
  const x = words(a).filter(w => !["the", "llc", "inc", "co"].includes(w)), y = words(b).filter(w => !["the", "llc", "inc", "co"].includes(w));
  if (!x.length || !y.length) return 0;
  const A = new Set(x), B = new Set(y), inter = [...A].filter(t => B.has(t)).length;
  const jac = inter / new Set([...A, ...B]).size;
  const sx = x.join(""), sy = y.join(""); const bg = s => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) m.set(s.slice(i, i + 2), (m.get(s.slice(i, i + 2)) || 0) + 1); return m; };
  const P = bg(sx), Q = bg(sy); let c = 0, t = 0; for (const [k, v] of P) { c += Math.min(v, Q.get(k) || 0); t += v; } for (const v of Q.values()) t += v;
  let s = 0.5 * jac + 0.5 * (t ? 2 * c / t : 0);
  if (sx.includes(sy) || sy.includes(sx)) s = Math.max(s, 0.85);
  return s;
}
// How well can a run-together string (an email handle or domain label) be spelled out of a studio's name?
// "mdsbestkarate" -> Maryland's(md+s) Best Karate
function handleMatch(handle, studioName) {
  const h = squash(handle).replace(/\d+/g, ""); const n = h.length; if (n < 4) return { score: 0 };
  const ws = words(studioName); if (!ws.length) return { score: 0 };
  const variants = ws.map(w => {
    const v = new Map(); const add = (x, credit) => { if (x && (!v.has(x) || v.get(x) < credit)) v.set(x, credit); };
    const bases = [w]; if (w.length > 3 && w.endsWith("s")) bases.push(w.slice(0, -1));
    for (const b of bases) { add(b, b.length); for (const a of ABBR[b] || []) { add(a, a.length); add(a + "s", a.length + 1); } }
    add(w[0], 0.5); return v;
  });
  let best = Array.from({ length: n + 1 }, () => null); best[0] = { score: 0, used: new Set(), full: new Set() };
  for (let i = 0; i < n; i++) {
    const cur = best[i]; if (!cur) continue;
    if (!best[i + 1] || best[i + 1].score < cur.score) best[i + 1] = cur;
    variants.forEach((v, k) => { for (const [x, credit] of v) {
      if (!h.startsWith(x, i)) continue; const j = i + x.length; const sc = cur.score + credit;
      if (!best[j] || best[j].score < sc) { const used = new Set(cur.used); used.add(k); const full = new Set(cur.full); if (credit >= 1) full.add(k); best[j] = { score: sc, used, full }; }
    } });
  }
  const end = best[n]; const coverage = end.score / n; const wordCov = end.used.size / ws.length;
  const distinctive = [...end.full].some(k => !GENERIC.has(ws[k]));
  let score = 0.6 * coverage + 0.4 * wordCov; if (!distinctive) score *= 0.5;
  return { score: Math.round(score * 100) / 100, coverage };
}
const matchScore = (input, name, isHandle) => Math.round(Math.max(isHandle ? 0 : nameSimilarity(input, name), handleMatch(input, name).score) * 100) / 100;

// ---------------------------------------------------------------- people
const pretty = t => { t = t.replace(/['’]s$/, ""); if (t === t.toUpperCase() || /^Mc[A-Z]{2,}/.test(t)) { t = t[0] + t.slice(1).toLowerCase(); if (/^Mc./.test(t)) t = "Mc" + t[2].toUpperCase() + t.slice(3); } return t; };
const nameLike = t => t.length >= 2 && /^[A-Z]/.test(t) && !NOT_NAMES.has(t.toLowerCase().replace(/['’]s$/, ""));
function tokens(text) { return [...text.matchAll(WORD_RE)].map(m => ({ s: m.index, e: m.index + m[0].length, w: m[0] })); }
// every adjacent pair of capitalised words, with or without a middle initial
function namePairs(text, toks) {
  const out = [];
  for (let i = 0; i < toks.length - 1; i++) {
    let j = i + 1; if (toks[j].w.length === 1 && /[A-Z]/.test(toks[j].w) && j + 1 < toks.length) j++;
    const a = toks[i], b = toks[j];
    if (!/^\s+(?:[A-Z]\.?\s+)?$/.test(text.slice(a.e, b.s))) continue;
    if (nameLike(a.w) && nameLike(b.w)) out.push({ start: a.s, end: b.e, first: pretty(a.w), last: pretty(b.w), name: `${pretty(a.w)} ${pretty(b.w)}` });
  }
  return out;
}
function confirmed(text, p) {
  const after = text.slice(p.end, p.end + 260).match(WORD_RE) || [];
  const fv = firstVariants(p.first.toLowerCase());
  if (after.some(w => fv.has(w.toLowerCase()) || w.toLowerCase() === p.last.toLowerCase())) return true;
  const near = text.slice(Math.max(0, p.start - 45), p.start) + " " + text.slice(p.end, p.end + 45);
  OWNER_RE.lastIndex = LEADER_RE.lastIndex = 0;
  if (OWNER_RE.test(near) || LEADER_RE.test(near) || HONORIFIC_RE.test(text.slice(Math.max(0, p.start - 16), p.start))) return true;
  return (text.match(new RegExp(p.first + "\\s+" + p.last, "gi")) || []).length >= 2;
}
const pageContext = (url, text) => { const h = (url + " " + text.slice(0, 300)).toLowerCase(); return /board|trustee/.test(h) ? "board" : /team|staff|instructor|coach|faculty|trainer/.test(h) ? "team" : null; };
function roleFor(text, occ, others, ctx) {
  const lo = Math.max(0, occ.start - 160), hi = Math.min(text.length, occ.end + 220), win = text.slice(lo, hi);
  let best = null;
  const consider = (re, level, rank) => {
    re.lastIndex = 0;
    for (const m of win.matchAll(re)) {
      const ks = lo + m.index, ke = ks + m[0].length;
      if (ctx === "board" && /^(board of directors|trustees?)$/i.test(m[0])) continue;
      const after = ks >= occ.end, dist = after ? ks - occ.end : ke <= occ.start ? occ.start - ke : 0;
      const apart = n => !(n.start < occ.end && n.end > occ.start);
      // bio pages put the title after the name: a title after this name belongs to it unless another name comes first;
      // a title before this name only counts when it sits right in front ("Owner: Sandra", "founded by Sandra")
      if (after && others.some(n => apart(n) && n.start >= occ.end && n.end <= ks)) continue;
      if (after && others.some(n => apart(n) && n.start >= ke && n.start - ke <= 25 && !/[.!?]/.test(text.slice(ke, n.start)))) continue; // "founder Marvin McDowell"
      if (!after && (dist > 40 || others.some(n => apart(n) && n.start >= ke && n.end <= occ.start))) continue;
      if (!best || rank > best.rank || (rank === best.rank && dist < best.dist)) best = { level, keyword: m[0], dist, rank };
    }
  };
  consider(OWNER_RE, "owner", 3); consider(LEADER_RE, "leader", 2); consider(STAFF_RE, "staff", 1);
  const hon = text.slice(Math.max(0, occ.start - 16), occ.start).match(HONORIFIC_RE);
  if (hon && (!best || best.rank < 2)) best = { level: hon[1] === "Coach" ? "staff" : "leader", keyword: hon[1], rank: hon[1] === "Coach" ? 1 : 2 };
  if (!best && ctx === "board") best = { level: "leader", keyword: "board member (board page)", rank: 2 };
  if (!best && ctx === "team") best = { level: "staff", keyword: "listed on team page", rank: 1 };
  return { ...(best || { level: "mentioned", keyword: null, rank: 0 }), snippet: text.slice(Math.max(0, occ.start - 100), occ.end + 160) };
}

// ---------------------------------------------------------------- email
function parseEmail(raw) {
  const e = (raw || "").trim().toLowerCase(); const m = e.match(/^([^@\s]+)@([^@\s]+\.[a-z]{2,})$/); if (!m) return null;
  const local = m[1].split("+")[0]; const parts = local.replace(/\d+/g, "").split(/[._-]+/).filter(Boolean);
  const label = m[2].split(".").slice(-2, -1)[0] || m[2];
  return { email: e, local, domain: regDomain(m[2]), label, freemail: FREEMAIL.has(m[2]), parts, squashed: parts.join(""), role: ROLE_LOCAL.test(parts.join("")) };
}
function emailMatchesPerson(pe, first, last, domainVerified) {
  const f0 = first.toLowerCase().replace(/[^a-z]/g, ""), l = last.toLowerCase().replace(/[^a-z]/g, ""); if (!f0 || !l) return null;
  const s = pe.squashed;
  for (const f of firstVariants(f0)) {
    if (s === f + l) return { strength: 3, pattern: "first + last name" };
    if (s === l + f) return { strength: 2.5, pattern: "last + first name" };
    if (s === f[0] + l || s === l + f[0]) return { strength: 2, pattern: "initial + surname" };
    if (s === f + l[0]) return { strength: 2, pattern: "first name + initial" };
    if (domainVerified && s === f) return { strength: 2, pattern: "first name at the studio's own domain" };
  }
  if (l.length >= 4 && s.includes(l) && [...firstVariants(f0)].some(f => s.includes(f))) return { strength: 2, pattern: "name inside a longer handle" };
  if (s === l && l.length >= 4) return { strength: 1, pattern: "surname only" };
  if (firstVariants(f0).has(s) && s.length >= 3) return { strength: 1, pattern: "first name only" };
  return null;
}

// ---------------------------------------------------------------- web
async function timedFetch(url, ms = 7000, init = {}) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { redirect: "follow", ...init, headers: { "user-agent": UA, ...(init.headers || {}) }, signal: ctl.signal }); }
  finally { clearTimeout(t); }
}
async function robotsAllows(url) {
  try {
    const u = new URL(url); const r = await timedFetch(`${u.origin}/robots.txt`, 3500); if (!r.ok) return true;
    let applies = false; const dis = [];
    for (const raw of (await r.text()).split(/\r?\n/)) { const line = raw.split("#")[0].trim(); const i = line.indexOf(":"); if (i < 0) continue; const k = line.slice(0, i).trim(), v = line.slice(i + 1).trim();
      if (/^user-agent$/i.test(k)) applies = v === "*" || /BoutiqueLeadVerifier/i.test(v); else if (applies && /^disallow$/i.test(k) && v) dis.push(v); }
    return !dis.some(p => u.pathname.startsWith(p));
  } catch { return true; }
}
async function getPage(url, ms = 7000) {
  try { const r = await timedFetch(url, ms); if (!r.ok) return { err: `HTTP ${r.status}` }; if (!/html/i.test(r.headers.get("content-type") || "html")) return { err: "not a web page" };
    return { url: r.url || url, html: (await r.text()).slice(0, 250000) }; } catch (e) { return { err: e.name === "AbortError" ? "timed out" : "unreachable" }; }
}
function siteHealth(name, html) {
  const text = (metaName(html) + " " + htmlToText(html)).toLowerCase().slice(0, 25000);
  if (PARKED.test(text)) return { status: "taken_over", detail: "Page looks parked or taken over by spam." };
  if (!name) return FITNESS_HINT.test(text) ? { status: "ok", detail: "Fitness-related site." } : { status: "not_fitness", detail: "Site isn't fitness-related." };
  const want = words(name).filter(w => !GENERIC.has(w) && w.length > 2); const need = want.length ? Math.ceil(want.length / 2) : 1;
  if (text.replace(/[^a-z0-9]/g, "").includes(squash(name)) || want.filter(w => text.includes(w)).length >= need) return { status: "ok", detail: "Site mentions the studio by name." };
  if (!FITNESS_HINT.test(text)) return { status: "taken_over", detail: "Site no longer mentions the studio or anything fitness-related." };
  return { status: "no_identity", detail: "Fitness site, but it doesn't mention this studio's name." };
}
async function discoverSite(name) {
  try {
    const r = await timedFetch("https://html.duckduckgo.com/html/", 7000, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "q=" + encodeURIComponent(`${name} Baltimore MD`) });
    if (!r.ok) return null; const html = await r.text();
    for (const m of html.matchAll(/class="result__a"[^>]*href="([^"]+)"/g)) {
      let url = decodeEntities(m[1]); const u = url.match(/uddg=([^&]+)/); if (u) url = decodeURIComponent(u[1]);
      if (!/^https?:/.test(url) || DIRECTORY.test(url)) continue;
      const home = new URL(url).origin + "/"; const p = await getPage(home, 5000);
      if (p.html && siteHealth(name, p.html).status === "ok") return p;
    }
  } catch {}
  return null;
}
async function nominatim(q) {
  try { const r = await timedFetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&extratags=1&addressdetails=1&limit=6&bounded=1&viewbox=${VIEWBOX}&q=${encodeURIComponent(q)}`, 6000, { headers: { "accept-language": "en" } });
    return r.ok ? await r.json() : []; } catch { return []; }
}
async function readSite(home) {
  // home = {url, html} already fetched
  if (!(await robotsAllows(home.url))) return { status: "blocked by robots.txt" };
  const root = hostOf(home.url); const links = [];
  for (const m of home.html.matchAll(/<a[^>]+href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let u; try { u = new URL(decodeEntities(m[1]), home.url); } catch { continue; }
    if (regDomain(u.hostname) !== root || u.href.replace(/\/$/, "") === home.url.replace(/\/$/, "")) continue;
    if (/about|team|staff|instructor|coach|trainer|owner|meet|story|founder|faculty|teacher|contact|bio|leadership|board|trustee|director|people|mission/i.test(u.pathname + " " + m[2]) && !links.includes(u.href)) links.push(u.href);
  }
  const prio = u => [/board|trustee|leadership|director/i, /team|staff|instructor|coach|trainer|faculty|people|meet/i, /about|story|founder|owner|bio|mission/i, /contact/i].findIndex(r => r.test(new URL(u).pathname));
  links.sort((a, b) => ((prio(a) + 5) % 5) - ((prio(b) + 5) % 5));
  const bookingLinks = [];
  for (const m of home.html.matchAll(/href=["']([^"'#]+)["']/gi)) {
    let u; try { u = new URL(decodeEntities(m[1]), home.url); } catch { continue; }
    if (regDomain(u.hostname) === root && /schedule|book|pricing|plans|membership|join|sign-?up|start|trial|register|store/i.test(u.pathname) && !links.includes(u.href) && !bookingLinks.includes(u.href)) bookingLinks.push(u.href);
  }
  const [extraAll, bookingPages] = await Promise.all([
    Promise.all(links.slice(0, 4).map(u => getPage(u, 6000))),
    Promise.all(bookingLinks.slice(0, 2).map(u => getPage(u, 5000)))]);
  const extra = extraAll.filter(p => p.html);
  const all = [home, ...extra]; const pages = all.map(p => ({ url: p.url, text: htmlToText(p.html).slice(0, 14000) }));
  const emails = []; for (const p of all) for (const e of findEmails(p.html)) if (!emails.some(x => x.email === e)) emails.push({ email: e, page: p.url });
  const alltext = pages.map(p => p.text).join(" ");
  return { status: "read", live: true, crawled_at: new Date().toISOString(), domain: root, site_url: home.url, pages, emails,
    tech: detectTech(home.url + "\n" + [...all, ...bookingPages.filter(p => p.html)].map(p => p.html).join("\n")), segment: segmentOf(root, alltext) };
}
const FAMILY_ORDER = ["Daxko", "Competitor", "Built-in booking", "Marketplace", "Marketing", "Analytics", "Site builder"];
function techAngle(tech) {
  const by = f => tech.filter(t => t.family === f).map(t => t.platform);
  const daxko = by("Daxko"), comp = by("Competitor"), built = by("Built-in booking"), market = by("Marketplace");
  let a;
  if (daxko.length) a = { label: "Existing Daxko customer", tone: "daxko", detail: `Runs ${daxko.join(", ")}. Expansion or cross-sell, not a new logo.` };
  else if (comp.length) a = { label: "Competitive displacement", tone: "comp", detail: `Runs ${comp.join(", ")}.` };
  else if (built.length) a = { label: "Greenfield", tone: "green", detail: `Books through ${built.join(", ")}, with no dedicated member software.` };
  else a = { label: "Stack not visible", tone: "none", detail: "No booking or member software found on the pages read." };
  if (market.length) a.detail += ` Also sells through ${market.join(", ")}.`;
  return a;
}
function segmentOf(domain, text) {
  if (/\.gov$/.test(domain) || /recreation (?:and|&) parks|rec (?:and|&) parks|department of recreation/i.test(text)) return "Public facility";
  if (/\.org$/.test(domain) || /501\s*\(c\)\s*\(3\)|non-?profit/i.test(text)) return "Nonprofit";
  return "Boutique";
}

// ---------------------------------------------------------------- pipeline
export async function onRequestPost({ request, env }) {
  let body; try { body = await request.json(); } catch { return json({ error: "Send JSON: {email, studio?}" }, 400); }
  const trace = []; const t0 = Date.now(); let tick = t0;
  const step = (title, status, detail, evidence = []) => { const now = Date.now(); trace.push({ title, status, detail, evidence, ms: now - tick }); tick = now; };
  const typed = (body.studio || "").trim();

  // 1 ── classify the address
  const pe = parseEmail(body.email);
  if (!pe) return json({ error: "That email address doesn't look valid." }, 400);
  let seed = { studios: [] };
  try { const r = await env.ASSETS.fetch(new URL("/data/seed.json", request.url)); if (r.ok) seed = await r.json(); } catch {}
  const S = seed.studios || [];

  let handleHit = null;
  if (pe.freemail && !pe.role) {
    const ranked = S.map(s => ({ s, score: handleMatch(pe.local, s.name).score })).sort((a, b) => b.score - a.score);
    if (ranked[0]?.score >= 0.75) handleHit = ranked;
  }
  let guessed = null;
  if (pe.freemail && !pe.role && !handleHit && !typed && pe.parts.length === 1 && pe.squashed.length >= 6) {
    for (const tld of ["com", "org"]) {
      const p = await getPage(`https://${pe.squashed}.${tld}/`, 4000);
      if (p.html && siteHealth("", p.html).status === "ok" && handleMatch(pe.squashed, metaName(p.html)).score >= 0.6) { guessed = p; break; }
    }
  }
  const kind = !pe.freemail ? "business" : (handleHit || guessed) ? "studio-handle" : pe.role ? "shared-personal" : "person-handle";
  const kindText = {
    business: `${pe.domain} is a business domain. If it's the studio's own site, no studio name is needed.`,
    "studio-handle": `Personal mailbox, but the handle “${pe.local}” spells out a studio name. Reading the studio from it.`,
    "shared-personal": `Personal mailbox used as a shared inbox (“${pe.local}”). The studio name is needed.`,
    "person-handle": `Personal mailbox with a personal handle. The domain says nothing about the business, so the studio name is needed.`,
  }[kind];
  step("Read the inbound address", "done", kindText, [
    { label: "Handle", value: pe.local }, { label: "Domain", value: `${pe.domain} (${pe.freemail ? "personal mailbox" : "business"})` },
    { label: "Handle type", value: pe.role ? "Shared inbox (info@, support@…)" : kind === "studio-handle" ? "Studio name" : "Person" }]);
  if ((kind === "person-handle" || kind === "shared-personal") && typed.length < 3)
    return json({ need: "studio", message: "This is a personal address, so add the studio name the lead gave.", trace });

  // 2 ── identify the studio
  let studio = null, conf = "None", method = "", home = null, siteNote = null, cands = [];
  if (kind === "business") {
    studio = S.find(s => [s.crawl?.domain, hostOf(s.website), hostOf(s.crawl?.site_url)].includes(pe.domain));
    if (studio) { conf = "High"; method = "Email domain matches the website on file"; }
    const p = await getPage(`https://${pe.domain}/`);
    if (p.html) {
      const h = siteHealth(studio?.name || "", p.html);
      if (h.status === "ok") {
        home = p;
        if (!studio) {
          const siteName = metaName(p.html);
          const ranked = S.map(s => ({ s, score: Math.max(matchScore(siteName, s.name), handleMatch(pe.label, s.name).score) })).sort((a, b) => b.score - a.score);
          cands = ranked.slice(0, 3);
          if (ranked[0]?.score >= 0.7) { studio = ranked[0].s; method = `Email domain's site is “${siteName}”, which matches the index`; siteNote = `Index lists ${studio.website || "no website"}; the email domain is the live one.`; }
          else { studio = { id: "live-" + pe.domain, name: siteName || pe.domain, category: "Not classified", website: `https://${pe.domain}/`, address: "", phone: "", osm_url: "" }; method = `Read the studio's name from ${pe.domain}`; }
          conf = "High";
        }
      }
    }
    if (!studio) {
      const employer = p.html ? siteHealth("", p.html).status !== "ok" : true;
      if (typed.length < 3) return json({ need: "studio", message: `${pe.domain} doesn't look like a studio's website${employer ? " (probably the lead's employer)" : ""}. Add the studio name the lead gave.`, trace });
      siteNote = `${pe.domain} isn't a studio site, so it's treated as the lead's employer.`;
    }
  }
  if (!studio && kind === "studio-handle" && guessed) {
    const dom = hostOf(guessed.url), siteName = metaName(guessed.html);
    studio = S.find(s => [s.crawl?.domain, hostOf(s.website)].includes(dom)) || { id: "live-" + dom, name: siteName, category: "Not classified", website: guessed.url, address: "", phone: "", osm_url: "" };
    if (!studio.crawl) home = guessed;
    conf = "High"; method = `Handle matches ${dom}, the studio's live website`;
  }
  if (!studio && kind === "studio-handle") { studio = handleHit[0].s; conf = handleHit[0].score >= 0.9 ? "High" : "Medium"; method = "Studio name spelled out in the email handle"; cands = handleHit.slice(0, 3); }
  if (!studio && typed) {
    const ranked = S.map(s => ({ s, score: matchScore(typed, s.name) + ((body.town && (s.address || "").toLowerCase().includes(body.town.toLowerCase())) ? 0.05 : 0) })).sort((a, b) => b.score - a.score);
    cands = ranked.slice(0, 3);
    if (ranked[0]?.score >= 0.6) { studio = ranked[0].s; conf = ranked[0].score >= 0.8 ? "High" : "Medium"; method = "Studio name typed by the lead, matched to the index"; }
    else {
      const hits = (await nominatim(`${typed} ${body.town || "Baltimore"}`)).map(h => ({ h, score: matchScore(typed, h.name || "") })).sort((a, b) => b.score - a.score);
      if (hits[0]?.score >= 0.55) {
        const { h } = hits[0], a = h.address || {}, x = h.extratags || {}; let site = x.website || x["contact:website"] || ""; if (site && !/^https?:/i.test(site)) site = "https://" + site;
        studio = { id: `live-osm-${h.osm_id}`, name: h.name, category: "Not classified", website: site, address: [a.house_number, a.road, a.city || a.town || a.village, a.postcode].filter(Boolean).join(" "), phone: x.phone || "", osm_url: `https://www.openstreetmap.org/${h.osm_type}/${h.osm_id}` };
        conf = "Medium"; method = "Live OpenStreetMap search";
      }
      if (!studio) {
        const found = await discoverSite(typed);
        if (found) { studio = { id: "live-" + hostOf(found.url), name: metaName(found.html) || typed, category: "Not classified", website: found.url, address: "", phone: "", osm_url: "" }; home = found; conf = "Medium"; method = "Found the studio's website by web search"; }
      }
    }
  }
  if (!studio) {
    step("Identify the studio", "stopped", `Couldn't find a Baltimore studio matching “${typed || pe.local}”.`, cands.map(c => ({ label: c.s.name, value: `match ${c.score}` })));
    return json({ trace, verdict: { company: { status: "Not identified", confidence: "None" }, person: { status: "Not checked" }, score: 0, routing: "Hold for manual research. Don't create or associate an account." }, record: [], ms: Date.now() - t0 });
  }
  const ev2 = cands.length ? cands.map(c => ({ label: c.s.name, value: `match ${c.score}` })) : [];
  if (typed && kind !== "person-handle" && kind !== "shared-personal" && matchScore(typed, studio.name) < 0.4) ev2.push({ label: `Typed name “${typed}” disagrees`, value: "trusting the email" });
  if (siteNote) ev2.push({ label: "Note", value: siteNote });
  step("Identify the studio", conf === "High" ? "done" : "weak", `${studio.name}. ${method}.`, ev2);

  // 3 ── is the website still theirs?
  let crawl = studio.crawl && studio.crawl.status === "read" && (studio.crawl.health?.status || "ok") === "ok" ? studio.crawl : null;
  let healthText = crawl ? (studio.crawl.site_source?.startsWith("Web search") ? `Listed link was bad, so the current site was found by search: ${crawl.site_url || crawl.domain}.` : `Site on file is live and mentions the studio (checked ${crawl.crawled_at?.slice(0, 10) || "at index time"}).`) : "";
  let healthStatus = crawl ? "done" : "weak";
  if (!crawl) {
    if (!home && studio.website && !/facebook|instagram|linktr/i.test(studio.website)) {
      const p = await getPage(studio.website);
      if (p.html) { const h = siteHealth(studio.name, p.html); if (h.status === "ok") home = p; else healthText = `Listed site ${hostOf(studio.website)}: ${h.detail} `; }
      else healthText = `Listed site ${hostOf(studio.website)} is down (${p.err}). `;
    } else if (!home) healthText = studio.website ? "Only a social media page is listed, which can't be read. " : "No website listed. ";
    if (!home) { const found = await discoverSite(studio.name); if (found) { home = found; healthText += `Found the current site by search: ${hostOf(found.url)}.`; } else healthText += "A web search didn't turn up a replacement."; }
    else if (!healthText) healthText = `${hostOf(home.url)} is live and belongs to the studio.`;
    if (home) { crawl = await readSite(home); healthStatus = "done"; } else healthStatus = "stopped";
  }
  const domain = crawl?.domain || "";
  step("Check the website is still the studio's", healthStatus, healthText.trim(), domain ? [{ label: "Domain", value: domain }] : []);

  // 4 ── read pages
  const pages = crawl?.pages || [];
  if (crawl) step("Read the studio's public pages", "done", `Read ${pages.length} page${pages.length === 1 ? "" : "s"}${crawl.live ? " just now" : " from the index"}, people pages first.`, pages.map(p => ({ label: pageContext(p.url, p.text) === "board" ? "Board page" : pageContext(p.url, p.text) === "team" ? "Team page" : "Page", value: p.url })));

  // 5 ── classify
  const segment = crawl?.segment || "Boutique";
  const tech = (crawl?.tech || []).slice().sort((a, b) => FAMILY_ORDER.indexOf(a.family) - FAMILY_ORDER.indexOf(b.family));
  const angle = techAngle(tech); const builder = tech.find(t => t.family === "Site builder");
  const member = tech.find(t => t.family === "Daxko" || t.family === "Competitor");
  if (crawl) step("Classify the account", "done",
    `${segment}${segment === "Nonprofit" ? " (Daxko's nonprofit segment, not boutique)" : segment === "Public facility" ? " (city-run, not a sales prospect)" : ""}. ${angle.label}: ${angle.detail}`,
    tech.map(t => ({ label: `${t.platform} (${t.family === "Daxko" ? "Daxko family" : t.family.toLowerCase()})`, value: t.evidence })));

  // 6 ── the person
  const domainVerified = !pe.freemail && pe.domain === domain;
  const published = (crawl?.emails || []).find(e => e.email === pe.email);
  let best = null;
  const inbox = pe.role || kind === "studio-handle";
  if (crawl && !inbox) for (const p of pages) {
    const toks = tokens(p.text); const pairs = namePairs(p.text, toks); const solid = pairs.filter(x => confirmed(p.text, x)); const ctx = pageContext(p.url, p.text);
    for (const occ of pairs) {
      const em = emailMatchesPerson(pe, occ.first, occ.last, domainVerified); if (!em) continue;
      const role = roleFor(p.text, occ, solid, ctx); const c = { ...occ, ...em, role, page: p.url };
      if (!best || c.strength * 10 + c.role.rank > best.strength * 10 + best.role.rank) best = c;
    }
  }
  if (crawl && !inbox && domainVerified && pe.parts.length === 1 && (!best || best.strength < 2)) for (const p of pages) {
    const toks = tokens(p.text); const solid = namePairs(p.text, toks).filter(x => confirmed(p.text, x)); const ctx = pageContext(p.url, p.text);
    const fv = firstVariants(pe.squashed);
    for (const t of toks) {
      if (!/^[A-Z]/.test(t.w) || !fv.has(t.w.toLowerCase())) continue;
      const occ = { start: t.s, end: t.e, first: pretty(t.w), last: "", name: pretty(t.w) };
      const role = roleFor(p.text, occ, solid, ctx); const c = { ...occ, strength: 2, pattern: "first name at the studio's own domain", role, page: p.url };
      if (!best || c.strength * 10 + c.role.rank > best.strength * 10 + best.role.rank) best = c;
    }
  }
  const signals = [];
  if (published) signals.push({ label: "This exact address is published on the studio's website", value: "+20", source: published.page });
  if (domainVerified) signals.push({ label: "Address is on the studio's own domain", value: "+15", source: domain });
  if (!pe.freemail && !domainVerified && domain) signals.push({ label: `${pe.domain} is a different organization (likely the lead's employer)`, value: "0", source: "Informational" });
  let person, pscore = 0;
  if (inbox) {
    person = { status: published || domainVerified ? "Studio's shared inbox" : kind === "studio-handle" ? "Studio's own mailbox (not on its website)" : "Shared inbox, not confirmed", level: "inbox" };
    pscore = published ? 60 : domainVerified ? 50 : kind === "studio-handle" ? 40 : 20;
    signals.unshift({ label: kind === "studio-handle" ? `“${pe.local}@” is the studio's own mailbox, not a person` : `“${pe.local}@” is a role address, not a person`, value: String(pscore - (published ? 20 : 0) - (domainVerified ? 15 : 0)), source: "Address pattern" });
  } else if (best) {
    const base = { owner: 80, leader: 60, staff: 30, mentioned: 20 }[best.role.level];
    const factor = { 3: 1, 2.5: 0.95, 2: 0.9, 1: 0.6 }[best.strength];
    const pts = Math.round(base * factor);
    signals.unshift({ label: `Address matches ${best.name} (${best.pattern}), described as ${best.role.keyword ? `“${best.role.keyword}”` : "no stated role"}`, value: `+${pts}`, snippet: best.role.snippet, highlight: best.name, source: best.page });
    pscore = pts;
    person = { status: { owner: "Owner / executive", leader: segment === "Nonprofit" && /board|trustee|chair|treasurer/i.test(best.role.keyword || "") ? "Board member" : "Leadership", staff: "Staff", mentioned: "Named on site, role unclear" }[best.role.level], level: best.role.level, name: best.name };
  } else {
    person = { status: "Not found on the studio's site", level: "none" };
    if (crawl) signals.unshift({ label: "No one on the studio's pages matches the name in this address", value: "0", source: pages.map(p => p.url).join("  ") });
  }
  pscore = Math.min(100, pscore + (published ? 20 : 0) + (domainVerified ? 15 : 0));
  step("Check the person against the studio", pscore >= 40 ? "done" : "weak", `${person.status}${person.name ? ": " + person.name : ""}.`, signals);

  // 7 ── route
  let routing;
  if (segment === "Public facility") routing = "Suppress from sales routing. City-run facility.";
  else if (person.level === "owner") routing = `Associate to the account as decision-maker and route to the ${segment.toLowerCase()} sales sequence.`;
  else if (person.status === "Board member") routing = "Associate to the account as a board member (approver). Route to the executive director or founder as the buyer.";
  else if (person.level === "leader") routing = "Associate to the account with a leadership flag. SDR confirms buying authority on first touch.";
  else if (person.level === "inbox") routing = "Associate to the account as the business inbox. Ask for the owner by name on first touch.";
  else if (person.level === "staff") routing = "Associate as an influencer. Find the owner before routing to sales.";
  else routing = conf === "High" ? "Associate to the account with an unverified-contact flag. SDR confirms role." : "Don't auto-associate. Send to the enrichment review queue.";
  const verdict = { company: { status: studio.name, confidence: conf, segment }, person, score: pscore, routing };
  step("Route the lead", "done", routing);

  const now = new Date().toISOString();
  const record = [
    ["Email", pe.email, "Inbound form", "Given"],
    ["Email type", inbox ? "Shared inbox" : pe.freemail ? "Personal mailbox" : domainVerified ? "Studio domain" : "Other organization's domain", "Parsed", "High"],
    ["First name", best?.first || "", best ? "Studio website" : "None", best ? "High" : "None"],
    ["Last name", best?.last || "", best ? "Studio website" : "None", best ? "High" : "None"],
    ["Role", best?.role.keyword || (inbox ? "Shared inbox" : "Unknown"), best ? "Studio website" : "None", best?.role.rank >= 2 ? "High" : best ? "Medium" : "None"],
    ["Company", studio.name, method, conf],
    ["Company domain", domain || "None", crawl?.site_source || "Website check", domain ? "High" : "None"],
    ["Business phone", studio.phone || "None listed", "OpenStreetMap", studio.phone ? "Medium" : "None"],
    ["Address", studio.address || "None listed", "OpenStreetMap", studio.address ? "Medium" : "None"],
    ["Segment", segment, "Domain and site text", "Medium"],
    ["Member software", member ? `${member.platform}${member.family === "Daxko" ? " (Daxko family)" : ""}` : "None found", "Website code", member ? "High" : "None"],
    ["Sales angle", angle.label, "Tech stack", tech.length ? "High" : "None"],
    ["Other tools", tech.filter(t => !["Daxko", "Competitor", "Site builder"].includes(t.family)).map(t => t.platform).join(", ") || "None found", "Website code", "Medium"],
    ["Site builder", builder?.platform || "Unknown", "Website code", builder ? "High" : "None"],
    ["Contact status", person.status, "This check", "—"],
    ["Contact score", String(pscore), "This check", "—"],
    ["Evidence URL", best?.page || published?.page || "None", "This check", "—"],
    ["SMS consent", "Unknown. Do not text.", "Default", "—"],
    ["Verified at", now, "This check", "—"],
  ].map(([field, value, source, confidence]) => ({ field, value, source, confidence }));
  return json({ trace, verdict, record, tech: { angle, items: tech }, ms: Date.now() - t0 });
}
export async function onRequestGet() { return json({ usage: "POST JSON {email, studio?, town?}" }); }
