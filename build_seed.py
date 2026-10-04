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

# Studios used as the one-click examples on the page. Always indexed, even outside the map area.
PINNED = [
    "https://www.kravmd.com/",
    "https://www.yogaunionbaltimore.com/",
    "https://nohooksbeforebooks.org/",
    "https://clippercitycrossfit.com/",
    "https://arrow-yoga.com/",
    "https://guardianbaltimore.org/",
]

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
    r"about|team|staff|instructor|coach|trainer|owner|meet|story|founder|faculty|teacher|"
    r"contact|bio|who-we-are|leadership|board|trustee|director|people|sensei|professor|mission", re.I)
# people pages first, contact pages after
BOOKING_HINT = re.compile(r"schedule|book|pricing|plans|membership|join|sign-?up|start|trial|register|store", re.I)
PAGE_PRIORITY = [r"board|trustee|leadership|director", r"team|staff|instructor|coach|trainer|faculty|teacher|people|meet|sensei|professor",
                 r"about|story|founder|owner|who-we-are|bio|mission", r"contact"]

# Tech fingerprints: (tool, family, pattern). Families drive the sales angle.
FINGERPRINTS = [
    ("Zen Planner", "Daxko", r"zenplanner\.com"),
    ("SugarWOD", "Daxko", r"sugarwod\.com"),
    ("UpLaunch", "Daxko", r"uplaunch\.com"),
    ("Exercise.com", "Daxko", r"\bexercise\.com"),
    ("Club Automation", "Daxko", r"clubautomation\.com"),
    ("GroupEx Pro", "Daxko", r"groupexpro\.com"),
    ("Daxko Operations", "Daxko", r"daxko\.com"),
    ("Mindbody", "Competitor", r"mindbodyonline\.com|healcode|mindbody\.io|brandedweb"),
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
    ("Jackrabbit", "Competitor", r"jackrabbitclass\.com"),
    ("Vagaro", "Competitor", r"vagaro\.com"),
    ("bsport", "Competitor", r"bsport\.io"),
    ("Punchpass", "Competitor", r"punchpass\.com"),
    ("Zingfit", "Competitor", r"zingfit\.com"),
    ("ABC Glofox / ABC Ignite", "Competitor", r"abcfitness\.com"),
    ("Wix Bookings", "Built-in booking", r"/booking-calendar/|/service-page/|/pricing-plans/"),
    ("Acuity / Squarespace Scheduling", "Built-in booking", r"acuityscheduling\.com"),
    ("Square Appointments", "Built-in booking", r"squareup\.com/appointments|square\.site"),
    ("Calendly", "Built-in booking", r"calendly\.com"),
    ("ClassPass", "Marketplace", r"classpass\.com"),
    ("GoHighLevel", "Marketing", r"reputationhub\.site|leadconnectorhq\.com|msgsndr\.com|gohighlevel"),
    ("HubSpot", "Marketing", r"js\.hs-scripts\.com|hsforms|hs-analytics"),
    ("Mailchimp", "Marketing", r"list-manage\.com|chimpstatic"),
    ("Klaviyo", "Marketing", r"klaviyo\.com"),
    ("Constant Contact", "Marketing", r"constantcontact\.com|ctctcdn\.com"),
    ("ActiveCampaign", "Marketing", r"activehosted\.com|activecampaign"),
    ("Meta Pixel", "Analytics", r"fbevents\.js|fbq\("),
    ("Google Analytics", "Analytics", r"googletagmanager\.com/gtag|google-analytics\.com|gtag\("),
    ("Google Tag Manager", "Analytics", r"googletagmanager\.com/gtm\.js"),
    ("Wix", "Site builder", r"wixstatic\.com|Wix\.com Website Builder"),
    ("Squarespace", "Site builder", r"squarespace\.com|squarespace-cdn\.com|sqspcdn\.com"),
    ("WordPress", "Site builder", r"wp-content|wp-includes"),
    ("GoDaddy Builder", "Site builder", r"img1\.wsimg\.com"),
    ("Weebly", "Site builder", r"weebly\.com"),
    ("Webflow", "Site builder", r"webflow\.com|website-files\.com"),
]

OWNER_RE = re.compile(r"\b(co-?owners?|owners?|co-?founders?|founders?|founded by|"
                      r"owned (?:and operated )?by|proprietor|executive director|(?<!vice )president|"
                      r"ceo|chief executive)\b", re.I)
LEADER_RE = re.compile(r"\b(head instructor|chief instructor|head coach|lead instructor|"
                       r"studio director|program director|managing director|general manager|"
                       r"studio manager|manager|board chair|chair(?:man|woman|person)?(?! yoga)|"
                       r"vice president|treasurer|board of directors|board member|trustees?|"
                       r"joined the [\w ]{0,20}board|on the board|director)\b", re.I)
HONORIFIC_RE = re.compile(r"\b(Sensei|Master|Professor|Grandmaster|Sifu|Shihan|Kyoshi|"
                          r"Sabumnim|Hanshi|Renshi|Coach)\s+")
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
esquire esq cpa phd jr sr senior vice chief officer development company university college high school
group design theory board partnerships press support menu directors operation accounting partner partners
president founder executive manager associates foundation program youth city county state ceo cfo coo blue green
brown purple red yellow orange gray grey white
""".split())

NICK = {"mike": "michael", "chris": "christopher", "kate": "katherine", "katie": "katherine", "jen": "jennifer",
        "jenn": "jennifer", "jenny": "jennifer", "liz": "elizabeth", "beth": "elizabeth", "dan": "daniel",
        "danny": "daniel", "matt": "matthew", "tom": "thomas", "rob": "robert", "bob": "robert", "bill": "william",
        "will": "william", "sam": "samuel", "alex": "alexander", "nick": "nicholas", "tony": "anthony",
        "jim": "james", "jimmy": "james", "joe": "joseph", "steve": "steven", "dave": "david", "ben": "benjamin",
        "andy": "andrew", "sue": "susan", "becky": "rebecca", "meg": "megan", "pat": "patrick", "ed": "edward",
        "greg": "gregory", "jon": "jonathan", "josh": "joshua", "tim": "timothy", "ken": "kenneth",
        "jeff": "jeffrey", "rich": "richard", "rick": "richard", "ron": "ronald", "don": "donald",
        "abby": "abigail", "maggie": "margaret", "peggy": "margaret", "cathy": "catherine", "kathy": "katherine"}


def same_first(a, b):
    a, b = a.lower(), b.lower()
    return a == b or NICK.get(a) == b or NICK.get(b) == a or (NICK.get(a) and NICK.get(a) == NICK.get(b))


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
    for img in soup.find_all("img", alt=True):
        img.replace_with(" " + img["alt"] + " ")
    for tag in soup(["script", "style", "noscript", "svg", "template", "iframe"]):
        tag.decompose()
    for br in soup.find_all(["br", "p", "li", "h1", "h2", "h3", "h4", "h5", "div"]):
        br.append(" ")
    return re.sub(r"\s+", " ", soup.get_text(" ")).strip()


WORD_RE = re.compile(r"[A-Za-z][A-Za-z'’]*(?:-[A-Za-z][A-Za-z'’]*)?")


def _name_like(tok):
    return len(tok) >= 2 and tok[0].isupper() and tok.lower().strip("'’") not in NOT_NAMES


def _pretty(tok):
    tok = re.sub(r"['’]s$", "", tok)
    if not tok.isupper() and not re.match(r"Mc[A-Z]{2,}", tok):
        return tok
    t = tok.capitalize()
    if t.startswith("Mc") and len(t) > 3:
        t = "Mc" + t[2:].capitalize()
    return t


def name_candidates(text):
    """Adjacent capitalised words (Title Case or ALL CAPS), optionally with a middle initial."""
    toks = [(m.start(), m.end(), m.group(0)) for m in WORD_RE.finditer(text)]
    out = []
    for i in range(len(toks) - 1):
        s1, e1, a = toks[i]
        j = i + 1
        if len(toks[j][2]) == 1 and toks[j][2].isupper() and j + 1 < len(toks):
            j += 1  # middle initial
        s2, e2, b = toks[j]
        if not re.fullmatch(r"\s+(?:[A-Z]\.?\s+)?", text[e1:s2]):
            continue
        if _name_like(a) and _name_like(b):
            out.append((s1, e2, f"{_pretty(a)} {_pretty(b)}", _confirmed(text, s1, e2, a, b)))
    # where candidates overlap ("EULA McDOWELL Eula"), keep the confirmed one
    keep = []
    for c in out:
        if keep and c[0] < keep[-1][1]:
            if c[3] and not keep[-1][3]:
                keep[-1] = c
            continue
        keep.append(c)
    return [(s, e, n) for s, e, n, ok in keep if ok]


def _confirmed(text, s, e, a, b):
    """Real names repeat: a bio heading is followed by the first name, a role sits right next to it,
    or the full name appears more than once on the page."""
    first, last = _pretty(a), _pretty(b)
    after = text[e:e + 260]
    for w in WORD_RE.findall(after):
        if same_first(w, first) or w.lower() == last.lower():
            return True
    near = text[max(0, s - 45):s] + " " + text[e:e + 45]
    if OWNER_RE.search(near) or LEADER_RE.search(near) or HONORIFIC_RE.search(text[max(0, s - 16):s]):
        return True
    full = re.escape(a) + r"\s+" + re.escape(b)
    return len(re.findall(full, text, re.I)) >= 2


def page_context(url, text):
    head = (url + " " + text[:300]).lower()
    if re.search(r"board|trustee", head):
        return "board"
    if re.search(r"team|staff|instructor|coach|faculty|trainer", head):
        return "team"
    return None


def extract_people(text, page_url):
    people = {}
    names = name_candidates(text)
    ctx = page_context(page_url, text)

    def add(name, level, keyword, start, end):
        rank = {"owner": 3, "leader": 2, "staff": 1}[level]
        cur = people.get(name)
        if not cur or rank > cur["_rank"]:
            people[name] = {"name": name, "level": level, "keyword": keyword, "page": page_url,
                            "snippet": text[max(0, start - 90): end + 120], "_rank": rank}

    def owner_of(ks, ke):
        """Bio pages put the title after the name: give a title to the closest name before it,
        or to the name right after it when nothing precedes ("Owner: Sandra Jenkins")."""
        right_after = [n for n in names if n[0] >= ke and n[0] - ke <= 25 and not re.search(r"[.!?]", text[ke:n[0]])]
        if right_after:
            return min(right_after, key=lambda n: n[0])  # "founder Marvin McDowell"
        before = [n for n in names if n[1] <= ks and ks - n[1] < 160]
        if before:
            return max(before, key=lambda n: n[1])
        after = [n for n in names if n[0] >= ke and n[0] - ke <= 40]
        return min(after, key=lambda n: n[0]) if after else None

    for regex, level in ((OWNER_RE, "owner"), (LEADER_RE, "leader")):
        for m in regex.finditer(text):
            if re.fullmatch(r"board of directors|trustees?", m.group(0), re.I) and ctx == "board":
                continue  # page heading, not a personal title
            who = owner_of(m.start(), m.end())
            if who:
                add(who[2], level, m.group(0), who[0], who[1])
    for s, e, nm in names:
        hm = HONORIFIC_RE.search(text[max(0, s - 16):s])
        if hm:
            add(nm, "staff" if hm.group(1) == "Coach" else "leader", hm.group(1), s, e)
        elif ctx == "board" and nm not in people:
            add(nm, "leader", "board member (board page)", s, e)
    for p in people.values():
        p.pop("_rank", None)
    return list(people.values())


def detect_tech(html_blobs, website):
    hits = []
    hay = website + "\n" + "\n".join(html_blobs)
    for label, family, pattern in FINGERPRINTS:
        m = re.search(pattern, hay, re.I)
        if m:
            ev = re.sub(r"\s+", " ", hay[max(0, m.start() - 50): m.end() + 50])
            hits.append({"platform": label, "family": family, "evidence": ev})
    return hits


# ------------------------------------------------------------ site health
PARKED = re.compile(r"domain (?:is )?for sale|buy this domain|this domain may be for sale|parked free|"
                    r"sedoparking|hugedomains|dan\.com|afternic|domain has expired|"
                    r"\b(?:casino|slot gacor|togel|judi|situs|betting|viagra|payday loan|escort)\b", re.I)
GENERIC_WORDS = set("""yoga studio studios boxing center centre fitness gym academy karate martial arts art the of and
baltimore md crossfit pilates barre dojo school club training jiu jitsu bjj mma kickboxing taekwondo judo kung fu
muay thai self defense athletics athletic performance power hot house co llc inc program""".split())
FITNESS_HINT = re.compile(r"yoga|pilates|barre|boxing|karate|martial|jiu|bjj|crossfit|taekwondo|judo|kung fu|"
                          r"muay|krav|dojo|gym|fitness|class schedule|free trial|instructor", re.I)


def distinctive(name):
    words = re.sub(r"[^a-z0-9 ]", "", name.lower().replace("’", "").replace("'", "")).split()
    return [w for w in words if w not in GENERIC_WORDS and len(w) > 2] or words


def site_health(name, html, final_url):
    """Is this page still the studio's site?"""
    soup = BeautifulSoup(html, "html.parser")
    title = (soup.title.get_text(" ") if soup.title else "")
    og = soup.find("meta", property="og:site_name")
    text = (title + " " + (og.get("content", "") if og else "") + " " + visible_text(soup)).lower()
    if PARKED.search(text[:20000]):
        return {"status": "taken_over", "detail": "Page looks parked or taken over by spam."}
    squashed = re.sub(r"[^a-z0-9]", "", text)
    want = distinctive(name)
    hits = [w for w in want if w in text]
    if re.sub(r"[^a-z0-9]", "", name.lower()) in squashed or len(hits) >= max(1, len(want) // 2 + len(want) % 2):
        return {"status": "ok", "detail": "Site mentions the studio by name."}
    if not FITNESS_HINT.search(text[:20000]):
        return {"status": "taken_over", "detail": "Site no longer mentions the studio or anything fitness-related."}
    return {"status": "no_identity", "detail": "Site is fitness-related but doesn't mention this studio's name."}


DIRECTORY_HOSTS = ("facebook.", "instagram.", "yelp.", "mapquest.", "yellowpages.", "classpass.", "mindbody",
                   "tripadvisor.", "bbb.org", "linkedin.", "groupon.", "nextdoor.", "google.", "bing.", "apple.com",
                   "foursquare.", "manta.com", "chamberofcommerce", "wikipedia.", "x.com", "twitter.", "tiktok.",
                   "youtube.", "duckduckgo.", "yogaalliance", "bjjgyms", "crossfit.com/affiliate")


def discover_site(name, area="Baltimore MD"):
    """Free web search for a studio's current site when the listed one is missing or dead."""
    try:
        r = session.post("https://html.duckduckgo.com/html/", data={"q": f"{name} {area}"}, timeout=12)
    except Exception:
        return None
    if r.status_code != 200:
        return None
    from urllib.parse import parse_qs, unquote
    for m in re.finditer(r'class="result__a"[^>]*href="([^"]+)"', r.text):
        href = m.group(1)
        q = parse_qs(urlparse(href).query).get("uddg")
        url = unquote(q[0]) if q else href
        host = urlparse(url).netloc.lower()
        if not host or any(d in url.lower() for d in DIRECTORY_HOSTS):
            continue
        final, html, err = get_html(f"{urlparse(url).scheme}://{host}/")
        if html and site_health(name, html, final)["status"] == "ok":
            return final
    return None


def segment_of(domain, text):
    t = text.lower()
    if domain.endswith(".gov") or re.search(r"recreation (?:and|&) parks|rec (?:and|&) parks|department of recreation", t):
        return "Public facility"
    if domain.endswith(".org") or re.search(r"501\s*\(c\)\s*\(3\)|non-?profit", t):
        return "Nonprofit"
    return "Boutique"


def crawl(studio):
    site = studio["website"]
    source = "OpenStreetMap"
    health = None
    host = urlparse(site).netloc.lower() if site else ""
    final = html = None
    if site and not any(h in host for h in SOCIAL_HOSTS):
        final, html, err = get_html(site)
        if html:
            health = site_health(studio["name"], html, final)
        else:
            health = {"status": "dead", "detail": f"Listed site failed: {err}."}
    else:
        health = {"status": "missing", "detail": "No readable website listed (none, or social media only)."}
    if health["status"] != "ok":
        time.sleep(2)
        found = discover_site(studio["name"])
        if found:
            final, html, err = get_html(found)
            source = "Web search (listed site was " + health["status"].replace("_", " ") + ")"
            health = {"status": "ok", "detail": f"Replaced: {health['detail']} Found current site by search."}
        else:
            return {"status": health["detail"], "health": health}

    soup = BeautifulSoup(html, "html.parser")
    root = urlparse(final).netloc.lower().removeprefix("www.")
    links = []
    for a in soup.find_all("a", href=True):
        href = urljoin(final, a["href"].split("#")[0])
        p = urlparse(href)
        if p.scheme not in ("http", "https") or p.netloc.lower().removeprefix("www.") != root:
            continue
        label = p.path + " " + a.get_text(" ")
        if PAGE_HINT.search(label) and href.rstrip("/") != final.rstrip("/") and href not in links:
            links.append(href)

    def prio(u):
        for i, pat in enumerate(PAGE_PRIORITY):
            if re.search(pat, urlparse(u).path, re.I):
                return i
        return len(PAGE_PRIORITY)
    links.sort(key=prio)

    booking_links = []
    for a in soup.find_all("a", href=True):
        href = urljoin(final, a["href"].split("#")[0])
        p = urlparse(href)
        if p.netloc.lower().removeprefix("www.") == root and BOOKING_HINT.search(p.path) and href not in links + booking_links:
            booking_links.append(href)
    pages, blobs, emails, people = [], [html], set(), {}

    def take(url, raw):
        s = BeautifulSoup(raw, "html.parser")
        for e in find_emails(raw, s):
            emails.add((e, url))
        txt = visible_text(s)
        pages.append({"url": url, "text": txt[:14000]})
        for p in extract_people(txt, url):
            cur = people.get(p["name"])
            rank = {"owner": 3, "leader": 2, "staff": 1}
            if not cur or rank[p["level"]] > rank[cur["level"]]:
                people[p["name"]] = p

    take(final, html)
    for link in links[:6]:
        time.sleep(1)
        u, raw, err = get_html(link)
        if raw:
            blobs.append(raw)
            take(u, raw)
    for link in booking_links[:3]:  # schedule / pricing pages carry the booking widgets
        time.sleep(1)
        u, raw, err = get_html(link)
        if raw:
            blobs.append(raw)
    alltext = " ".join(p["text"] for p in pages)
    return {
        "status": "read",
        "crawled_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "domain": root,
        "site_url": final,
        "site_source": source,
        "health": health,
        "segment": segment_of(root, alltext),
        "pages": pages,
        "emails": [{"email": e, "page": u} for e, u in sorted(emails)],
        "people": sorted(people.values(), key=lambda p: {"owner": 0, "leader": 1, "staff": 2}[p["level"]])[:20],
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

    # pinned example studios go first; reuse the map record when the domain matches
    pinned = []
    for url in PINNED:
        dom = urlparse(url).netloc.lower().removeprefix("www.")
        match = next((s for s in studios if urlparse(s["website"]).netloc.lower().removeprefix("www.") == dom), None)
        if match:
            pinned.append(match)
            continue
        final, html, err = get_html(url)
        if not html:
            log(f"  pinned example {dom} skipped: {err}")
            continue
        soup = BeautifulSoup(html, "html.parser")
        og = soup.find("meta", property="og:site_name")
        name = (og.get("content") if og else "") or (soup.title.get_text(" ").split("|")[0] if soup.title else dom)
        name = re.sub(r"\s+", " ", name).strip()
        pinned.append({"id": f"pin-{dom}", "name": name,
                       "category": categorize(name, {}) or categorize(name, {"sport": visible_text(soup)[:3000]}) or "Other",
                       "address": "", "city": "", "phone": "", "website": final, "osm_url": "", "pinned": True})
    ids = {s["id"] for s in pinned}
    queue = pinned + [s for s in with_site if s["id"] not in ids]
    queue = queue[: max(args.limit, len(pinned))]

    kept, dropped = [], []
    for i, s in enumerate(queue, 1):
        log(f"[{i}/{len(queue)}] {s['name']}")
        try:
            s["crawl"] = crawl(s)
        except Exception as ex:
            s["crawl"] = {"status": f"error ({type(ex).__name__})"}
        ok = s["crawl"].get("status") == "read"
        log(f"      {'read' if ok else 'DROPPED: ' + s['crawl']['status']}"
            + (f"; people: {len(s['crawl'].get('people', []))}; tech: "
               + ", ".join(t['platform'] for t in s['crawl'].get('tech', [])) if ok else ""))
        (kept if ok else dropped).append(s)
        time.sleep(1)
    studios = kept

    out = {
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "area": "Baltimore metro" if args.wide else "Baltimore City",
        "source": "OpenStreetMap contributors (ODbL) + studios' own public websites",
        "studios": studios,
        "dropped": [{"name": s["name"], "reason": s["crawl"]["status"]} for s in dropped],
    }
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    read = len(studios)
    owners = sum(1 for s in studios
                 if any(p["level"] in ("owner", "leader") for p in s.get("crawl", {}).get("people", [])))
    log(f"\nDone. Wrote {args.out}")
    replaced = sum(1 for s in studios if "search" in s.get("crawl", {}).get("site_source", "").lower())
    log(f"Indexed: {read} ({replaced} found by search after a dead link). Dropped (dead, squatted, or no site): {len(dropped)}.")
    log(f"Studios with a named owner/lead: {owners}.")


if __name__ == "__main__":
    main()
