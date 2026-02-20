"""
DGMarket tender scraper.

Searches https://appel-d-offre.dgmarket.com for procurement notices
in the Information & Communications sector across Africa.

Requires a session initialization flow:
1. GET /um~user/newSession.do?dgsessionid=...  → sets JSESSIONID cookie
2. GET /tenders/list.do?...keywords=...&status=live  → returns HTML with listings
"""

import re
import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv
from shared_excel import SEARCH_KEYWORDS, get_search_keywords, format_date

load_dotenv()

# ── Config ───────────────────────────────────────────────────────────────────

BASE_HOST = "https://appel-d-offre.dgmarket.com"
SESSION_URL = f"{BASE_HOST}/um~user/newSession.do"
SEARCH_URL = f"{BASE_HOST}/tenders/list.do"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/144.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
}

# Fixed search params (Info & Communications in Africa, live tenders only)
SEARCH_PARAMS = {
    "sub": "info-communications-in-Africa-10",
    "locationISO": "_s",
    "data_type": "P",
    "updated": "all",
    "cpv_only_p": "0",
    "status": "live",
}


# ── Session management ──────────────────────────────────────────────────────


def _init_session() -> requests.Session:
    """Initialize a fresh DGMarket session dynamically.

    Flow:
      1. Visit the homepage to get a JSESSIONID cookie from the server.
      2. Hit the newSession.do endpoint using that JSESSIONID so the server
         associates our session with a valid user context.
    """
    session = requests.Session()
    session.headers.update(HEADERS)
    session.max_redirects = 10  # Safety: prevent infinite redirect loops

    print("    [>] Initializing DGMarket session...", flush=True)

    # Step 1: Visit homepage to get fresh JSESSIONID
    try:
        home_resp = session.get(BASE_HOST, timeout=30)
        home_resp.raise_for_status()
    except requests.RequestException as e:
        print(f"    [!] Failed to load DGMarket homepage: {e}", flush=True)
        raise

    jsessionid = session.cookies.get("JSESSIONID", "")
    if not jsessionid:
        print("    [!] No JSESSIONID from homepage, trying newSession directly...", flush=True)

    # Step 2: Hit session endpoint to validate/activate the session
    try:
        # Use the JSESSIONID we got from the homepage as the dgsessionid
        session_param = jsessionid if jsessionid else ""
        resp = session.get(
            SESSION_URL,
            params={"dgsessionid": session_param},
            timeout=30,
        )
        resp.raise_for_status()
    except requests.RequestException as e:
        print(f"    [!] Session init request failed: {e}", flush=True)
        raise

    final_jsessionid = session.cookies.get("JSESSIONID", "?")
    print(f"    [+] Session ready (JSESSIONID={final_jsessionid[:12]}...)", flush=True)
    return session


# ── HTML parsing ─────────────────────────────────────────────────────────────


def _parse_date_text(raw: str) -> str:
    """
    Parse DGMarket date text like 'Publié Fév 16, 2026' into a standard date.
    Returns formatted date or empty string.
    """
    if not raw:
        return ""

    # Clean up the text — strip known French prefixes that may be glued to the month
    text = raw.strip()
    for prefix in ("Publié", "Publi\xe9", "Publié", "Publie"):
        if text.startswith(prefix):
            text = text[len(prefix):].strip()
            break

    # Month mapping (French abbreviations → English)
    FR_MONTHS = {
        "jan": "Jan", "fév": "Feb", "f\xe9v": "Feb", "mar": "Mar",
        "avr": "Apr", "mai": "May", "jun": "Jun", "jui": "Jul",
        "aoû": "Aug", "ao\xfb": "Aug", "sep": "Sep", "oct": "Oct",
        "nov": "Nov", "déc": "Dec", "d\xe9c": "Dec",
    }

    # Extract date portion: look for "Mon DD, YYYY"
    match = re.search(r"(\w+)\s+(\d{1,2}),?\s+(\d{4})", text)
    if match:
        month_str = match.group(1).lower()[:3]
        day = match.group(2)
        year = match.group(3)

        eng_month = FR_MONTHS.get(month_str, month_str.capitalize())
        try:
            from datetime import datetime
            dt = datetime.strptime(f"{eng_month} {day} {year}", "%b %d %Y")
            return dt.strftime("%m/%d/%Y")
        except ValueError:
            pass

    return format_date(text)


def _parse_tender_row(tr_tag) -> dict | None:
    """Parse a single <tr> from the results table into a project dict."""
    tds = tr_tag.find_all("td", recursive=False)
    if len(tds) < 3:
        return None

    # TD[0]: title, country, type, donor
    td_main = tds[0]

    # Title & link
    title_div = td_main.find("div", class_="ln_notice_title")
    if not title_div:
        return None
    link = title_div.find("a")
    if not link:
        return None

    title = link.get_text(strip=True)
    href = link.get("href", "")

    # Extract noticeId from href
    notice_id = ""
    id_match = re.search(r"noticeId=(\d+)", href)
    if id_match:
        notice_id = id_match.group(1)

    # Country
    country = ""
    country_span = td_main.find("span", class_=lambda c: c and "country_icon" in c if c else False)
    if country_span:
        listing_span = country_span.find_next_sibling("span", class_="ln_listing")
        if listing_span:
            country_link = listing_span.find("a")
            country = (country_link.get_text(strip=True) if country_link
                       else listing_span.get_text(strip=True))

    # Donor / funding agency
    donor = ""
    buyer_span = td_main.find("span", class_=lambda c: c and "buyer_icon" in c if c else False)
    if buyer_span:
        listing_span = buyer_span.find_next_sibling("span", class_="ln_listing")
        if listing_span:
            donor = listing_span.get_text(strip=True)

    # TD[2]: Published date
    pub_date = ""
    if len(tds) >= 3:
        date_text = tds[2].get_text(strip=True)
        pub_date = _parse_date_text(date_text)

    # Build project URL
    project_url = f"{BASE_HOST}{href}" if href else ""

    return {
        "project_id": notice_id,
        "project_name": title,
        "project_start_date": pub_date,
        "project_end_date": "",       # DGMarket doesn't show deadline in listing
        "project_description": title,
        "project_sponsor": country,
        "source": "DGMarket",
        "document_url": "",
        "project_url": project_url,
        "matched_keywords": "",
    }


# ── Search ───────────────────────────────────────────────────────────────────


def fetch_keyword(session: requests.Session, keyword: str) -> list[dict]:
    """Search DGMarket for a single keyword, parsing the HTML results."""
    params = dict(SEARCH_PARAMS)
    params["keywords"] = keyword

    try:
        resp = session.get(SEARCH_URL, params=params, timeout=30, allow_redirects=True)
        resp.raise_for_status()
    except requests.exceptions.TooManyRedirects:
        print(f"    [!] Too many redirects — session may have expired, retrying init...", flush=True)
        return []
    except requests.RequestException as e:
        print(f"    [!] Request error: {e}", flush=True)
        return []

    soup = BeautifulSoup(resp.text, "html.parser")

    # Each tender is its own table.list_notice_table (one tender per table)
    tables = soup.find_all("table", class_="list_notice_table")
    if not tables:
        return []

    projects = []
    for table in tables:
        for tr in table.find_all("tr"):
            project = _parse_tender_row(tr)
            if project:
                projects.append(project)

    return projects


# ── Main entry point ─────────────────────────────────────────────────────────


def run_dgmarket_scraper():
    """Search all keywords on DGMarket, deduplicate, return projects."""
    print("\n" + "=" * 60, flush=True)
    print("  DGMarket Scraper", flush=True)
    print("  Searching Info & Communications tenders in Africa", flush=True)
    print("=" * 60, flush=True)

    try:
        session = _init_session()
    except Exception as e:
        print(f"[!] Failed to initialize DGMarket session: {e}", flush=True)
        return []

    seen = {}
    total_raw = 0

    keywords = get_search_keywords()
    for keyword in keywords:
        print(f"\n[>] Searching: '{keyword}'", flush=True)
        projects = fetch_keyword(session, keyword)
        print(f"    Found {len(projects)} tenders", flush=True)
        total_raw += len(projects)

        for project in projects:
            dedup_key = (project["project_id"], project["project_description"])

            if dedup_key in seen:
                existing = seen[dedup_key]
                kw_list = existing.get("matched_keywords", "").split(", ")
                if keyword not in kw_list:
                    kw_list.append(keyword)
                    existing["matched_keywords"] = ", ".join(kw_list)
            else:
                project["matched_keywords"] = keyword
                seen[dedup_key] = project

    all_projects = list(seen.values())
    print(f"\n[+] Total raw tenders: {total_raw}", flush=True)
    print(f"[+] Unique tenders after dedup: {len(all_projects)}", flush=True)

    return all_projects


if __name__ == "__main__":
    results = run_dgmarket_scraper()
    print(f"\n[+] Final: {len(results)} unique projects")
    for p in results[:5]:
        print(f"  - [{p['project_id']}] {p['project_name'][:80]} ({p['project_sponsor']})")
