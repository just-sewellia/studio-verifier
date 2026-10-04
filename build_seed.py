#!/usr/bin/env python3
"""
Build the studio index for the boutique lead-verification demo.

What it does:
  1. Asks OpenStreetMap (free, no key) for martial arts, BJJ, yoga,
     CrossFit/functional and Pilates/barre studios in Baltimore.
  2. Drops chains and multi-location brands.
  3. Visits each studio's own public website (respecting robots.txt),
     reads the home / about / team / contact pages, and records:
       - the page text (so the live checker can search it later)
       - any email addresses the studio publishes
       - people named near words like "owner" or "founder"
       - the booking software and site builder the site uses
  4. Writes everything to public/data/seed.json

Run:  python build_seed.py            (Baltimore City)
      python build_seed.py --wide     (city + county ring)
"""
import argparse
import datetime as dt
import json
import re
import sys
import time
from urllib import robotparser
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

# ---------------------------------------------------------------- EDIT ME
CONTACT_EMAIL = "erica.szalkowski@gmail.com"   # put your real email here (sites see it)
# -----------------------------------------------------------------------

USER_AGENT = f"BoutiqueLeadVerifier/1.0 (portfolio demo; contact: {CONTACT_EMAIL})"
OVERPASS_URL = "https://overpass-api.de/api/interpreter"

BBOX_CITY = (39.197, -76.712, 39.372, -76.529)   # south, west, north, east
BBOX_WIDE = (39.150, -76.900, 39.550, -76.350)

CATEGORIES = [
    ("BJJ", r"jiu|bjj|grappl"),
    ("Martial arts", r"martial|karate|taekwondo|tae kwon|tkd|judo|kung|muay|kickbox|krav|"
                     r"aikido|dojo|mma|boxing|wing chun|hapkido|kendo|capoeira|jeet"),
    ("Yoga", r"yoga"),
    ("Pilates / barre", r"pilates|barre"),
    ("CrossFit / functional", r"crossfit|functional|barbell|kettlebell|boot ?camp|"
                              r"strength|conditioning"),
]

CHAINS = [
    "orangetheory", "planet fitness", "la fitness", "crunch", "anytime fitness",
    "gold's", "golds gym", "retro fitness", "ymca", "jcc", "corepower", "yogaworks",
    "club pilates", "pure barre", "solidcore", "f45", "title boxing", "9round",
    "ufc gym", "tiger schulmann", "amerikick", "stretchlab", "row house", "cyclebar",
    "yogasix", "barry's", "burn boot camp", "life time", "lifetime", "equinox",
    "24 hour", "merritt", "brick bodies", "planet", "snap fitness", "mayweather",
    "premier martial arts", "ata martial arts", "hot yoga for life", "baltimore athletic club",
]

SOCIAL_HOSTS = ("facebook.com", "instagram.com", "linktr.ee", "linkedin.com",
                "yelp.com", "google.com", "tiktok.com", "x.com", "twitter.com")

PAGE_HINT = re.compile(
    r"about|team|staff|instructor|coach|owner|meet|story|founder|faculty|teacher|"
    r"contact|bio|who-we-are|leadership|sensei|professor", re.I)

# Booking / member software fingerprints. "Daxko" = a Daxko-family brand.
FINGERPRINTS = [
    ("Zen Planner", "Daxko", r"zenplanner\.com"),
    ("SugarWOD", "Daxko", r"sugarwod\.com"),
    ("UpLaunch", "Daxko", r"uplaunch\.com"),
    ("Exercise.com", "Daxko", r"\bexercise\.com"),
    ("Club Automation", "Daxko", r"clubautomation\.com"),
    ("Daxko", "Daxko", r"daxko\.com"),
    ("Mindbody", "Competitor", r"mindbodyonline\.com|healcode|mindbody\.io"),
    ("Glofox", "Competitor", r"glofox\.com"),
    ("Wodify", "Competitor", r"wodify\.com"),
    ("PushPress", "Competitor", r"pushpress\.com"),
    ("Pike13", "Competitor", r"pike13\.com"),
    ("Momence", "Competitor", r"momence\.com"),
    ("WellnessLiving", "Competitor", r"wellnessliving\.com"),
    ("Walla", "Competitor", r"hellowalla\.com"),
    ("Arbox", "Competitor", r"arboxapp\.com"),
    ("Mariana Tek", "Competitor", r"marianatek\.com"),
    ("TeamUp", "Competitor", r"goteamup\.com"),
    ("Gymdesk", "Competitor", r"gymdesk\.com"),
    ("Spark Membership", "Competitor", r"sparkmembership\.com"),
    ("Kicksite", "Competitor", r"kicksite\.(?:net|com)"),
    ("ClubReady", "Competitor", r"clubready\.com"),
    ("Vagaro", "Competitor", r"vagaro\.com"),
    ("bsport", "Competitor", r"bsport\.io"),
    ("Punchpass", "Competitor", r"punchpass\.com"),
    ("Zingfit", "Competitor", r"zingfit\.com"),
    ("Acuity Scheduling", "General scheduler", r"acuityscheduling\.com"),
    ("Calendly", "General scheduler", r"calendly\.com"),
    ("Square", "General scheduler", r"squareup\.com/appointments|square\.site"),
    ("Wix", "Site builder", r"wixstatic\.com|wix\.com"),
    ("Squarespace", "Site builder", r"squarespace\.com|sqspcdn\.com"),
    ("WordPress", "Site builder", r"wp-content|wp-includes"),
    ("GoDaddy Builder", "Site builder", r"img1\.wsimg\.com"),
    ("Weebly", "Site builder", r"weebly\.com"),
    ("HubSpot", "Marketing tool", r"js\.hs-scripts\.com|hsforms"),
    ("Mailchimp", "Marketing tool", r"list-manage\.com|chimpstatic"),
]

OWNER_RE = re.compile(r"\b(co-?owners?|owners?|co-?founders?|founders?|founded by|"
                      r"owned (?:and operated )?by|proprietor)\b", re.I)
LEADER_RE = re.compile(r"\b(head instructor|chief instructor|head coach|lead instructor|"
                       r"studio director|program director|general manager|studio manager)\b", re.I)
HONORIFIC_RE = re.compile(r"\b(Sensei|Master|Professor|Grandmaster|Sifu|Shihan|Kyoshi|"
                          r"Sabumnim|Hanshi|Renshi|Coach)\s+")
_TOK = r"(?:[A-Z][a-z]*['’-]?[A-Z][a-z]+|[A-Z][a-z]+)"
# lookahead so overlapping candidates are all seen ("Sensei Paul McGraw" -> "Paul McGraw")
NAME_RE = re.compile(r"(?<![A-Za-z])(?=(" + _TOK + r")\s+(?:[A-Z]\.\s+)?(" + _TOK + r")(?![A-Za-z]))")
EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")

NOT_NAMES = set("""
the our your meet about contact home black belt brazilian jiu jitsu martial arts yoga studio
pilates barre fitness gym academy center centre baltimore maryland head instructor coach owner
founder director master sensei professor grand kids adult adults class classes schedule free trial
monday tuesday wednesday thursday friday saturday sunday january february march april may june
july august september october november december read more learn sign up book now join today new
welcome team staff program programs alliance certified teacher training hot power vinyasa hatha
yin kundalini ashtanga restorative krav maga muay thai tae kwon do kung fu judo karate boxing
kickboxing self defense personal group private online virtual policy privacy terms rights reserved
copyright powered street avenue road suite north south east west federal hill fells point canton
hampden mount vernon towson columbia inner harbor station united states world champion
championship national international olympic strength conditioning functional crossfit level
certificate degree dan rank lineage testimonials reviews google facebook instagram youtube gift
card cards shop store member members membership login register mind body soul spirit peace love
community family wellness health healing holistic reiki meditation breathwork sound bath retreat
workshop workshops event events blog news faq pricing prices rates location locations hours open
closed parking directions map email phone call text us we my mr mrs ms dr miss gracie barra
studios inc llc co club fit athletics athletic performance mixed self little ninjas tigers
dragons warriors little lions fundamentals advanced beginner beginners intermediate all levels
st ave rd blvd dr ste get started started contact us view details click here go back
""".split())


def log(msg):
    print(msg, flush=True)


# ----------------------------------------------------------- OpenStreetMap
def overpass_query(bbox):
    s, w, n, e = bbox
    b = f"({s},{w},{n},{e})"
    sports = ("martial_arts|karate|taekwondo|judo|jiu-jitsu|brazilian_jiu-jitsu|kickboxing|"
              "muay_thai|aikido|kung_fu|yoga|crossfit|pilates|boxing|mma|krav_maga")
    names = ("yoga|pilates|barre|crossfit|jiu|bjj|karate|taekwondo|martial|dojo|kung fu|"
             "muay|krav|kickbox|mma|judo")
    return f"""
[out:json][timeout:90];
(
  nwr["sport"~"{sports}",i]{b};
  nwr["amenity"="dojo"]{b};
  nwr["leisure"~"fitness_centre|sports_centre"]["name"~"{names}",i]{b};
  nwr["club"="sport"]["name"~"{names}",i]{b};
);
out center tags;
"""


def fetch_osm(bbox):
    log("Asking OpenStreetMap for studios...")
    r = requests.post(OVERPASS_URL, data={"data": overpass_query(bbox)},
                      headers={"User-Agent": USER_AGENT}, timeout=120)
    r.raise_for_status()
    return r.json().get("elements", [])


def categorize(name, tags):
    hay = f"{name} {tags.get('sport', '')}".lower().replace("_", " ")
    for label, pattern in CATEGORIES:
        if re.search(pattern, hay):
            return label
    return None


def norm_name(name):
    return re.sub(r"[^a-z0-9]+", " ", name.lower()).strip()


def clean_url(u):
    u = (u or "").strip()
    if not u:
        return ""
    if not re.match(r"https?://", u):
        u = "https://" + u
    return u


def to_studios(elements):
    rows = []
    for el in elements:
        t = el.get("tags", {})
        name = t.get("name", "").strip()
        if not name or t.get("shop") or t.get("brand") or t.get("brand:wikidata"):
            continue
        low = name.lower()
        if any(c in low for c in CHAINS):
            continue
        cat = categorize(name, t)
        if not cat:
            continue
        website = clean_url(t.get("website") or t.get("contact:website") or t.get("url"))
        addr = " ".join(x for x in [t.get("addr:housenumber"), t.get("addr:street")] if x)
        city = t.get("addr:city", "")
        rows.append({
            "id": f"osm-{el['type']}-{el['id']}",
            "name": name,
            "category": cat,
            "address": ", ".join(x for x in [addr, city, t.get("addr:postcode", "")] if x),
            "city": city,
            "phone": t.get("phone") or t.get("contact:phone") or "",
            "website": website,
            "osm_url": f"https://www.openstreetmap.org/{el['type']}/{el['id']}",
        })
    # single-location filter: drop any name that shows up more than once
    counts = {}
    for r in rows:
        counts[norm_name(r["name"])] = counts.get(norm_name(r["name"]), 0) + 1
    seen, out = set(), []
    for r in rows:
        key = norm_name(r["name"])
        if counts[key] > 1 or key in seen:
            continue
        seen.add(key)
        out.append(r)
    return out


# ------------------------------------------------------------- web reading
session = requests.Session()
session.headers.update({"User-Agent": USER_AGENT, "Accept": "text/html,*/*;q=0.5"})
_robots = {}


def robots_ok(url):
    p = urlparse(url)
    base = f"{p.scheme}://{p.netloc}"
    if base not in _robots:
        rp = robotparser.RobotFileParser()
        try:
            r = session.get(base + "/robots.txt", timeout=8)
            rp.parse(r.text.splitlines() if r.status_code == 200 else [])
        except Exception:
            rp.parse([])
        _robots[base] = rp
    return _robots[base].can_fetch(USER_AGENT, url)


def get_html(url):
    if not robots_ok(url):
        return None, None, "blocked by robots.txt"
    try:
        r = session.get(url, timeout=12, allow_redirects=True)
    except Exception as ex:
        return None, None, f"fetch failed ({type(ex).__name__})"
    if r.status_code >= 400:
        return None, None, f"HTTP {r.status_code}"
    if "html" not in r.headers.get("content-type", "").lower():
        return None, None, "not an HTML page"
    return r.url, r.text[:600_000], None


def decode_cfemail(hexstr):
    try:
        key = int(hexstr[:2], 16)
        return "".join(chr(int(hexstr[i:i + 2], 16) ^ key) for i in range(2, len(hexstr), 2))
    except Exception:
        return ""


BAD_EMAIL = re.compile(r"\.(png|jpe?g|gif|webp|svg|css|js)$|sentry|wixpress|example\.|"
                       r"domain\.com|email\.com|yourdomain|godaddy|squarespace|@2x|"
                       r"u003e|mysite", re.I)


def find_emails(html, soup):
    found = set()
    for a in soup.select("a[href^=mailto]"):
        found.add(a["href"][7:].split("?")[0].strip().lower())
    for el in soup.select("[data-cfemail]"):
        found.add(decode_cfemail(el["data-cfemail"]).lower())
    for m in EMAIL_RE.findall(html):
        found.add(m.lower())
    return sorted(e for e in found if e and "@" in e and not BAD_EMAIL.search(e))


def visible_text(soup):
    for tag in soup(["script", "style", "noscript", "svg", "template", "iframe"]):
        tag.decompose()
    for br in soup.find_all(["br", "p", "li", "h1", "h2", "h3", "h4", "h5", "div"]):
        br.append(" ")
    return re.sub(r"\s+", " ", soup.get_text(" ")).strip()


def name_candidates(text):
    out = []
    for m in NAME_RE.finditer(text):
        a, b = m.group(1), m.group(2)
        if a.lower() in NOT_NAMES or b.lower() in NOT_NAMES or len(a) < 2 or len(b) < 2:
            continue
        out.append((m.start(), m.end(2), f"{a} {b}"))
    return out


def extract_people(text, page_url):
    people = {}
    names = name_candidates(text)

    def add(name, level, keyword, start, end):
        snippet = text[max(0, start - 90): end + 90]
        rank = {"owner": 3, "leader": 2, "staff": 1}[level]
        cur = people.get(name)
        if not cur or rank > cur["_rank"]:
            people[name] = {"name": name, "level": level, "keyword": keyword,
                            "page": page_url, "snippet": snippet, "_rank": rank}

    for regex, level in ((OWNER_RE, "owner"), (LEADER_RE, "leader")):
        for m in regex.finditer(text):
            best, best_d = None, 999
            for s, e, nm in names:
                d = (s - m.end()) if s >= m.end() else (m.start() - e)
                if 0 <= d < 110 and d < best_d:
                    best, best_d = (s, e, nm), d
            if best:
                add(best[2], level, m.group(0), best[0], best[1])
    for s, e, nm in names:
        pre = text[max(0, s - 14):s]
        hm = HONORIFIC_RE.search(pre)
        if hm:
            add(nm, "staff" if hm.group(1) == "Coach" else "leader", hm.group(1), s, e)
    for p in people.values():
        p.pop("_rank", None)
    return list(people.values())


def detect_tech(html_blobs, website):
    hits = []
    hay = website + "\n" + "\n".join(html_blobs)
    for label, family, pattern in FINGERPRINTS:
        m = re.search(pattern, hay, re.I)
        if m:
            ev = hay[max(0, m.start() - 50): m.end() + 50]
            ev = re.sub(r"\s+", " ", ev)
            hits.append({"platform": label, "family": family, "evidence": ev})
    return hits


def crawl(studio):
    site = studio["website"]
    host = urlparse(site).netloc.lower()
    if not site:
        return {"status": "no website listed"}
    if any(h in host for h in SOCIAL_HOSTS):
        return {"status": "social page only (not readable without login)"}
    final, html, err = get_html(site)
    if err:
        return {"status": err}
    soup = BeautifulSoup(html, "html.parser")
    root = urlparse(final).netloc.lower().removeprefix("www.")
    links = []
    for a in soup.find_all("a", href=True):
        href = urljoin(final, a["href"].split("#")[0])
        p = urlparse(href)
        if p.scheme not in ("http", "https") or p.netloc.lower().removeprefix("www.") != root:
            continue
        if PAGE_HINT.search(p.path) or PAGE_HINT.search(a.get_text(" ")):
            if href.rstrip("/") != final.rstrip("/") and href not in links:
                links.append(href)
    pages, blobs, emails, people = [], [html], set(), {}

    def take(url, raw):
        s = BeautifulSoup(raw, "html.parser")
        for e in find_emails(raw, s):
            emails.add((e, url))
        txt = visible_text(s)
        pages.append({"url": url, "text": txt[:12000]})
        for p in extract_people(txt, url):
            if p["name"] not in people or p["level"] == "owner":
                people[p["name"]] = p

    take(final, html)
    for link in links[:5]:
        time.sleep(1)
        u, raw, err = get_html(link)
        if raw:
            blobs.append(raw)
            take(u, raw)
    return {
        "status": "read",
        "crawled_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "domain": root,
        "pages": pages,
        "emails": [{"email": e, "page": u} for e, u in sorted(emails)],
        "people": sorted(people.values(),
                         key=lambda p: {"owner": 0, "leader": 1, "staff": 2}[p["level"]])[:15],
        "tech": detect_tech(blobs, final),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--wide", action="store_true", help="include the county ring")
    ap.add_argument("--limit", type=int, default=60, help="max studios to read")
    ap.add_argument("--out", default="public/data/seed.json")
    args = ap.parse_args()

    if CONTACT_EMAIL == "you@example.com":
        sys.exit("Open build_seed.py and set CONTACT_EMAIL near the top first.")

    studios = to_studios(fetch_osm(BBOX_WIDE if args.wide else BBOX_CITY))
    with_site = [s for s in studios if s["website"]]
    log(f"Found {len(studios)} single-location studios, {len(with_site)} list a website.")
    studios = (with_site + [s for s in studios if not s["website"]])[: args.limit]

    for i, s in enumerate(studios, 1):
        log(f"[{i}/{len(studios)}] {s['name']}")
        try:
            s["crawl"] = crawl(s)
        except Exception as ex:
            s["crawl"] = {"status": f"error ({type(ex).__name__})"}
        log(f"      {s['crawl']['status']}; people: {len(s['crawl'].get('people', []))}")
        time.sleep(1)

    out = {
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "area": "Baltimore metro" if args.wide else "Baltimore City",
        "source": "OpenStreetMap contributors (ODbL) + studios' own public websites",
        "studios": studios,
    }
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    read = sum(1 for s in studios if s.get("crawl", {}).get("status") == "read")
    owners = sum(1 for s in studios
                 if any(p["level"] in ("owner", "leader") for p in s.get("crawl", {}).get("people", [])))
    log(f"\nDone. Wrote {args.out}")
    log(f"Websites read: {read}.  Studios with a named owner/lead: {owners}.")


if __name__ == "__main__":
    main()
