"""
DGMarket tender scraper.

Searches https://appel-d-offre.dgmarket.com for procurement notices
in the Information & Communications sector across Africa.

Requires a session initialization flow:
1. GET /um~user/newSession.do?dgsessionid=... -> sets JSESSIONID cookie
2. GET /tenders/list.do?...keywords=...&status=live -> returns HTML with listings
"""

import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from urllib.parse import urlencode

import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv
from shared_excel import get_search_keywords, format_date

try:
    from openai import OpenAI
except Exception:
    OpenAI = None

try:
    from ai_enrichment import (
        DEEPSEEK_API_KEY,
        DEEPSEEK_BASE_URL,
        _deepseek_request,
        _parse_json_response,
    )
except ImportError:
    from backend.ai_enrichment import (
        DEEPSEEK_API_KEY,
        DEEPSEEK_BASE_URL,
        _deepseek_request,
        _parse_json_response,
    )

load_dotenv(override=False)

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

SEARCH_PARAMS = {
    "sub": "info-communications-in-Africa-10",
    "locationISO": "_s",
    "data_type": "P",
    "updated": "all",
    "cpv_only_p": "0",
    "status": "live",
    "d-446978-s": "p",
}

DEEPSEEK_MODEL = "deepseek-chat"
DEADLINE_PROMPT = """You are extracting a procurement submission deadline from DGMarket notice text.

You will receive the full DGMarket notice table text.
Return ONLY valid JSON with this exact schema:
{
  "deadline_found": boolean,
  "deadline_label": string|null,
  "deadline_raw": string|null,
  "deadline_iso": string|null,
  "confidence": "low|medium|high"
}

Rules:
- Only mark deadline_found=true if the text explicitly states a submission deadline, closing date, bid deadline, proposal due date, or equivalent.
- Ignore posted on, publication date, issue date, updated date, opening date, award date, or other unrelated dates.
- If the text is ambiguous, indirect, missing, or you are not certain, return deadline_found=false.
- Never guess or infer dates.
- deadline_iso must be in YYYY-MM-DD format if and only if the deadline is explicit.
- If no explicit deadline exists, deadline_label, deadline_raw, and deadline_iso must be null.
- Confidence must be high only when the deadline is explicit and unambiguous.
"""

DETAIL_FETCH_WORKERS = 4
DETAIL_KEYWORD_TERMS = (
    "closing date",
    "deadline",
    "submission deadline",
    "proposal due",
    "bid due",
    "tender closing",
    "due date",
)
VALID_DEADLINE_LABEL_TERMS = (
    "closing",
    "deadline",
    "submission",
    "proposal due",
    "bid due",
    "tender closing",
    "due date",
)


def _init_session() -> requests.Session:
    """Initialize a fresh DGMarket session."""
    session = requests.Session()
    session.headers.update(HEADERS)
    session.max_redirects = 10

    print("    [>] Initializing DGMarket session...", flush=True)

    try:
        resp = session.get(
            SEARCH_URL,
            params={"sub": "info-communications-in-Africa-10", "status": "live", "keywords": "test"},
            timeout=30,
            allow_redirects=False,
        )

        redirect_count = 0
        while resp.is_redirect and redirect_count < 10:
            redirect_count += 1
            location = resp.headers.get("Location", "")
            if not location:
                break
            if location.startswith("/"):
                from urllib.parse import urljoin
                location = urljoin(SEARCH_URL, location)
            _dedup_jsessionid(session)
            resp = session.get(location, timeout=30, allow_redirects=False)

        _dedup_jsessionid(session)

    except requests.exceptions.TooManyRedirects:
        print("    [!] Redirect loop on search, trying direct session init...", flush=True)
        session.cookies.clear()
        try:
            session.get(SESSION_URL, timeout=30)
            _dedup_jsessionid(session)
        except Exception as exc:
            print(f"    [!] Fallback session init failed: {exc}", flush=True)
            raise
    except Exception as exc:
        if "multiple cookies" in str(exc).lower():
            print("    [!] Duplicate cookie detected, cleaning up...", flush=True)
            _dedup_jsessionid(session)
        else:
            print(f"    [!] Session init failed: {exc}", flush=True)
            raise

    jsessionid = session.cookies.get("JSESSIONID", "?")
    print(f"    [+] Session ready (JSESSIONID={jsessionid[:12]}...)", flush=True)
    return session


def _dedup_jsessionid(session: requests.Session):
    """Keep only the last JSESSIONID cookie, removing duplicates."""
    jsessionid = None
    domain = None
    for cookie in session.cookies:
        if cookie.name == "JSESSIONID":
            jsessionid = cookie.value
            domain = cookie.domain
    if jsessionid:
        to_remove = [c for c in session.cookies if c.name == "JSESSIONID"]
        if len(to_remove) > 1:
            session.cookies.clear()
            session.cookies.set("JSESSIONID", jsessionid, domain=domain or "appel-d-offre.dgmarket.com")


def _parse_date_text(raw: str) -> str:
    """Parse DGMarket listing date text into MM/DD/YYYY."""
    if not raw:
        return ""

    text = raw.strip()
    for prefix in ("Publie", "Publi?", "Publié", "Publi??"):
        if text.startswith(prefix):
            text = text[len(prefix):].strip()
            break

    fr_months = {
        "jan": "Jan", "f?v": "Feb", "fev": "Feb", "fév": "Feb",
        "mar": "Mar", "avr": "Apr", "mai": "May", "jun": "Jun",
        "jui": "Jul", "ao?": "Aug", "aou": "Aug", "aoû": "Aug",
        "sep": "Sep", "oct": "Oct", "nov": "Nov", "d?c": "Dec", "dec": "Dec",
    }

    match = re.search(r"(\w+)\s+(\d{1,2}),?\s+(\d{4})", text)
    if match:
        month_str = match.group(1).lower()[:3]
        day = match.group(2)
        year = match.group(3)
        eng_month = fr_months.get(month_str, month_str.capitalize())
        try:
            dt = datetime.strptime(f"{eng_month} {day} {year}", "%b %d %Y")
            return dt.strftime("%m/%d/%Y")
        except ValueError:
            pass

    return format_date(text)


def _extract_notice_id(href: str, raw_link_html: str = "") -> str:
    """Extract noticeId robustly across parser variations."""
    candidates = [href or "", raw_link_html or ""]
    for candidate in candidates:
        if not candidate:
            continue
        normalized = candidate.replace("&amp;", "&").replace("¬iceId", "&noticeId")
        match = re.search(r"(?:[?&]|)noticeId=(\d+)", normalized, flags=re.IGNORECASE)
        if match:
            return match.group(1)
    return ""


def _sanitize_keyword(keyword: str) -> str:
    """Remove accidental notice-id tails from keywords."""
    if not keyword:
        return ""
    clean = keyword.strip()
    return re.sub(r"(?:&noticeId|¬iceId)=\d+\s*$", "", clean, flags=re.IGNORECASE)


def _normalize_notice_text(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "")).strip()


def _build_deepseek_client():
    if not DEEPSEEK_API_KEY or OpenAI is None:
        return None
    try:
        return OpenAI(api_key=DEEPSEEK_API_KEY, base_url=DEEPSEEK_BASE_URL)
    except Exception as exc:
        print(f"    [!] DeepSeek client init failed: {exc}", flush=True)
        return None


def _clone_detail_session(base_session: requests.Session) -> requests.Session:
    session = requests.Session()
    session.headers.update(base_session.headers)
    session.cookies.update(base_session.cookies)
    session.max_redirects = getattr(base_session, "max_redirects", 10)
    return session


def _get_detail_notice_text(session: requests.Session, project_url: str) -> str:
    if not project_url:
        return ""
    try:
        resp = session.get(project_url, timeout=20, allow_redirects=True)
        resp.raise_for_status()
    except requests.RequestException as exc:
        print(f"    [!] DGMarket detail request failed: {exc}", flush=True)
        return ""

    soup = BeautifulSoup(resp.text, "html.parser")
    target_table = None
    for table in soup.find_all("table", class_="notice_table"):
        width = str(table.get("width", "")).strip()
        if width == "98%":
            target_table = table
            break
    if target_table is None:
        target_table = soup.find("table", class_="notice_table")

    if target_table is None:
        print("    [!] DGMarket detail page missing notice_table", flush=True)
        return ""

    table_text = _normalize_notice_text(target_table.get_text(" ", strip=True))
    if not table_text:
        print("    [!] DGMarket notice_table is empty", flush=True)
        return ""
    return table_text


def _contains_deadline_keywords(text: str) -> bool:
    lowered = (text or "").lower()
    return any(term in lowered for term in DETAIL_KEYWORD_TERMS)


def _normalize_deadline_iso(value: str | None) -> str | None:
    if not value:
        return None
    text = str(value).strip()
    for fmt in ("%Y-%m-%d", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M:%S.%f", "%Y-%m-%dT%H:%M:%S%z"):
        try:
            return datetime.strptime(text, fmt).date().isoformat()
        except ValueError:
            continue
    if text.endswith("Z"):
        try:
            return datetime.fromisoformat(text.replace("Z", "+00:00")).date().isoformat()
        except ValueError:
            return None
    try:
        return datetime.fromisoformat(text).date().isoformat()
    except ValueError:
        return None


def _iso_to_display_date(value: str) -> str:
    return datetime.strptime(value, "%Y-%m-%d").strftime("%m/%d/%Y")


def _is_explicit_deadline_label(value: str | None) -> bool:
    lowered = str(value or "").strip().lower()
    if not lowered:
        return False
    return any(term in lowered for term in VALID_DEADLINE_LABEL_TERMS)


def _extract_high_confidence_deadline(client, project: dict, notice_table_text: str) -> str:
    if client is None or not notice_table_text:
        return ""

    user_prompt = (
        f"Project title: {project.get('project_name', '')}\n"
        f"Project URL: {project.get('project_url', '')}\n"
        f"Full notice table text:\n{notice_table_text}"
    )

    try:
        content = _deepseek_request(
            client,
            DEADLINE_PROMPT,
            user_prompt,
            max_tokens=250,
            temperature=0.0,
            label="DGMarketDeadline",
        )
    except Exception as exc:
        print(f"    [!] DeepSeek deadline request failed: {exc}", flush=True)
        return ""

    payload = _parse_json_response(content)
    if not isinstance(payload, dict):
        print("    [!] DeepSeek returned invalid deadline JSON", flush=True)
        return ""

    deadline_found = payload.get("deadline_found") is True
    deadline_label = payload.get("deadline_label")
    confidence = str(payload.get("confidence", "")).strip().lower()
    deadline_iso = _normalize_deadline_iso(payload.get("deadline_iso"))

    if not deadline_found:
        return ""
    if not _is_explicit_deadline_label(deadline_label):
        print("    [i] DGMarket deadline skipped due to non-deadline label", flush=True)
        return ""
    if confidence != "high":
        print("    [i] DGMarket deadline skipped due to non-high confidence", flush=True)
        return ""
    if not deadline_iso:
        print("    [!] DGMarket deadline skipped due to invalid deadline_iso", flush=True)
        return ""

    try:
        return _iso_to_display_date(deadline_iso)
    except ValueError:
        print("    [!] DGMarket deadline skipped due to invalid normalized date", flush=True)
        return ""


def _fetch_detail_notice_texts(base_session: requests.Session, projects: list[dict]) -> dict[int, str]:
    detail_map: dict[int, str] = {}
    eligible = [(idx, project) for idx, project in enumerate(projects) if project.get("project_url") and not project.get("project_end_date")]
    if not eligible:
        return detail_map

    def worker(project_url: str) -> str:
        session = _clone_detail_session(base_session)
        return _get_detail_notice_text(session, project_url)

    with ThreadPoolExecutor(max_workers=DETAIL_FETCH_WORKERS) as executor:
        future_map = {
            executor.submit(worker, project.get("project_url", "")): idx
            for idx, project in eligible
        }
        for future in as_completed(future_map):
            idx = future_map[future]
            try:
                detail_map[idx] = future.result() or ""
            except Exception as exc:
                print(f"    [!] DGMarket detail fetch failed: {exc}", flush=True)
                detail_map[idx] = ""
    return detail_map


def _enrich_project_deadlines(session: requests.Session, client, projects: list[dict]):
    detail_texts = _fetch_detail_notice_texts(session, projects)
    if not detail_texts:
        return

    for idx, project in enumerate(projects, 1):
        if project.get("project_end_date"):
            continue
        notice_text = detail_texts.get(idx - 1, "")
        if not notice_text:
            continue
        if not _contains_deadline_keywords(notice_text):
            continue
        deadline_value = _extract_high_confidence_deadline(client, project, notice_text)
        if deadline_value and not project.get("project_end_date"):
            project["project_end_date"] = deadline_value


def _parse_tender_row(tr_tag, keyword: str) -> dict | None:
    """Parse a single <tr> from the results table into a project dict."""
    tds = tr_tag.find_all("td", recursive=False)
    if len(tds) < 3:
        return None

    td_main = tds[0]
    title_div = td_main.find("div", class_="ln_notice_title")
    if not title_div:
        return None
    link = title_div.find("a")
    if not link:
        return None

    title = link.get_text(strip=True)
    href = link.get("href", "")
    raw_link_html = str(link)
    notice_id = _extract_notice_id(href, raw_link_html)

    country = ""
    country_span = td_main.find("span", class_=lambda c: c and "country_icon" in c if c else False)
    if country_span:
        listing_span = country_span.find_next_sibling("span", class_="ln_listing")
        if listing_span:
            country_link = listing_span.find("a")
            country = country_link.get_text(strip=True) if country_link else listing_span.get_text(strip=True)

    pub_date = ""
    if len(tds) >= 3:
        pub_date = _parse_date_text(tds[2].get_text(strip=True))

    safe_keyword = _sanitize_keyword(keyword)
    project_url = ""
    if notice_id:
        query = urlencode({"keywords": safe_keyword, "noticeId": notice_id})
        project_url = f"{BASE_HOST}/tenders/np-notice.do?{query}"

    return {
        "project_id": notice_id,
        "project_name": title,
        "project_start_date": pub_date,
        "project_end_date": "",
        "project_description": title,
        "project_sponsor": country,
        "source": "DGMarket",
        "document_url": "",
        "project_url": project_url,
        "matched_keywords": "",
    }


def fetch_keyword(session: requests.Session, keyword: str) -> list[dict]:
    """Search DGMarket for a single keyword, parsing the HTML results."""
    params = dict(SEARCH_PARAMS)
    params["keywords"] = keyword

    try:
        resp = session.get(SEARCH_URL, params=params, timeout=30, allow_redirects=True)
        resp.raise_for_status()
    except requests.exceptions.TooManyRedirects:
        print("    [!] Too many redirects - session may have expired, retrying init...", flush=True)
        return []
    except requests.RequestException as exc:
        print(f"    [!] Request error: {exc}", flush=True)
        return []

    soup = BeautifulSoup(resp.text, "html.parser")
    tables = soup.find_all("table", class_="list_notice_table")
    if not tables:
        return []

    projects = []
    for table in tables:
        for tr in table.find_all("tr"):
            project = _parse_tender_row(tr, keyword)
            if project:
                projects.append(project)

    return projects


def run_dgmarket_scraper():
    """Search all keywords on DGMarket, deduplicate, enrich explicit deadlines, return projects."""
    print("\n" + "=" * 60, flush=True)
    print("  DGMarket Scraper", flush=True)
    print("  Searching Info & Communications tenders in Africa", flush=True)
    print("=" * 60, flush=True)

    try:
        session = _init_session()
    except Exception as exc:
        print(f"[!] Failed to initialize DGMarket session: {exc}", flush=True)
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
                kw_list = existing.get("matched_keywords", "").split(", ") if existing.get("matched_keywords") else []
                if keyword not in kw_list:
                    kw_list.append(keyword)
                    existing["matched_keywords"] = ", ".join(kw_list)
            else:
                project["matched_keywords"] = keyword
                seen[dedup_key] = project

    all_projects = list(seen.values())
    print(f"\n[+] Total raw tenders: {total_raw}", flush=True)
    print(f"[+] Unique tenders after dedup: {len(all_projects)}", flush=True)

    client = _build_deepseek_client()
    if client and all_projects:
        print("\n[>] Checking DGMarket detail pages for explicit deadlines", flush=True)
        try:
            _enrich_project_deadlines(session, client, all_projects)
        except Exception as exc:
            print(f"    [!] DGMarket deadline enrichment failed: {exc}", flush=True)
    elif not DEEPSEEK_API_KEY:
        print("\n[i] DeepSeek API key missing, skipping DGMarket deadline enrichment", flush=True)

    return all_projects


if __name__ == "__main__":
    results = run_dgmarket_scraper()
    print(f"\n[+] Final: {len(results)} unique projects")
    for p in results[:5]:
        print(f"  - [{p['project_id']}] {p['project_name'][:80]} ({p['project_sponsor']})")
