"""
Africa Gateway Tender Scraper.

Scrapes https://www.africagateway.info/index.php/esearch for tender notices.
Parses HTML table results using BeautifulSoup.
No browser required — plain HTTP requests.
"""

import re
import time
import random
import requests
from urllib.parse import urljoin, parse_qs, urlparse
from bs4 import BeautifulSoup

from shared_excel import get_search_keywords, format_date


BASE_URL = "https://www.africagateway.info/index.php/esearch"
RESULTS_PER_PAGE = 100
MAX_PAGES = 5  # Safety cap per keyword

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

# Date format used by the site: "26-Feb-2026"
DATE_RE = re.compile(r"\d{2}-[A-Za-z]{3}-\d{4}")


def _build_url(keyword, page=1):
    """Build the search URL for a keyword and page number."""
    params = f"keywords={requests.utils.quote(keyword)}&limit={RESULTS_PER_PAGE}"
    if page > 1:
        params += f"&page={page}"
    return f"{BASE_URL}?{params}"


def _parse_date(raw):
    """Parse 'DD-Mon-YYYY' into 'YYYY-MM-DD', or return raw string."""
    if not raw or raw.strip().upper() == "N/A":
        return ""
    raw = raw.strip()
    try:
        from datetime import datetime
        dt = datetime.strptime(raw, "%d-%b-%Y")
        return dt.strftime("%Y-%m-%d")
    except ValueError:
        return raw


def _extract_ref_id(href):
    """Extract the ref= parameter from a tenderdetails URL."""
    if not href:
        return ""
    parsed = urlparse(href)
    qs = parse_qs(parsed.query)
    ref_list = qs.get("ref", [])
    return ref_list[0] if ref_list else ""


def _fetch_page(session, keyword, page=1):
    """Fetch a single page of search results.

    Returns: (list_of_project_dicts, has_next_page)
    """
    url = _build_url(keyword, page)
    print(f"    [>] Fetching: {url}", flush=True)

    for attempt in range(3):
        try:
            start = time.time()
            resp = session.get(url, headers=HEADERS, timeout=30)
            elapsed = time.time() - start
            print(f"    [>] HTTP {resp.status_code} ({elapsed:.1f}s, {len(resp.text)} bytes)", flush=True)

            if resp.status_code == 429:
                wait = 15 + random.uniform(5, 10)
                print(f"    [!] Rate limited (429), waiting {wait:.0f}s...", flush=True)
                time.sleep(wait)
                continue

            if resp.status_code != 200:
                print(f"    [!] HTTP {resp.status_code}", flush=True)
                return [], False

            return _parse_page(resp.text)

        except Exception as e:
            if attempt < 2:
                wait = (2 ** attempt) * 3 + random.uniform(1, 3)
                print(f"    [!] Error (attempt {attempt + 1}), retrying in {wait:.0f}s: {e}", flush=True)
                time.sleep(wait)
            else:
                print(f"    [!] Failed after 3 attempts: {e}", flush=True)
                return [], False

    return [], False


def _parse_page(html):
    """Parse HTML and extract tender data from the results table.

    Returns: (list_of_project_dicts, has_next_page)
    """
    soup = BeautifulSoup(html, "html.parser")

    # Find the results table — it uses class "table table-striped"
    table = soup.select_one("table.table-striped")
    if not table:
        print("    [!] No results table found in HTML", flush=True)
        return [], False

    projects = []
    rows = table.select("tr")
    skipped_contracts = 0

    for row in rows:
        cells = row.select("td")
        if len(cells) < 5:
            continue  # Skip header rows or malformed rows

        try:
            project = _parse_row(cells)
            if project:
                projects.append(project)
            elif cells[3].get_text(strip=True).lower() in ("contract", "contract award"):
                skipped_contracts += 1
        except Exception as e:
            print(f"    [!] Error parsing row: {e}", flush=True)

    # Check for next page in pagination
    has_next = False
    pagination = soup.select_one("ul.pagination")
    if pagination:
        next_li = pagination.select_one("li.next a")
        if next_li and next_li.get("href"):
            has_next = True

    print(f"    [>] Parsed {len(rows)} rows -> {len(projects)} tenders, {skipped_contracts} contracts skipped, next_page={has_next}", flush=True)
    return projects, has_next


def _parse_row(cells):
    """Parse a single table row (5 <td> cells) into a project dict.

    Columns: Location | Date | Title+Link | Type | Deadline
    """
    location = cells[0].get_text(strip=True)
    date_raw = cells[1].get_text(strip=True)
    title_cell = cells[2]
    notice_type = cells[3].get_text(strip=True)
    deadline_raw = cells[4].get_text(strip=True)

    # Skip contract awards — we only want live tenders
    if notice_type.lower() in ("contract", "contract award"):
        return None

    # Extract title and link
    link = title_cell.select_one("a")
    if link:
        title = link.get_text(strip=True)
        href = link.get("href", "")
        detail_url = href if href.startswith("http") else urljoin(BASE_URL, href)
        ref_id = _extract_ref_id(href)
    else:
        title = title_cell.get_text(strip=True)
        detail_url = ""
        ref_id = ""

    if not title:
        return None

    # Parse dates
    pub_date = _parse_date(date_raw)
    end_date = _parse_date(deadline_raw)

    # Use ref ID as project_id, fallback to hash of title
    project_id = ref_id or str(abs(hash(title)))

    return {
        "project_id": project_id,
        "project_name": "",
        "project_start_date": pub_date,
        "project_end_date": end_date,
        "project_description": title,
        "project_sponsor": location,
        "source": "Africa Gateway",
        "document_url": "",
        "project_url": detail_url,
    }


def fetch_keyword(session, keyword, request_count):
    """Fetch first page of results for a keyword.

    Results are sorted by publish date (newest first), so page 1
    always contains the latest tenders. No need to paginate.

    Args:
        session: requests.Session
        keyword: search keyword
        request_count: current total request count (for rate limiting)

    Returns:
        (projects, updated_request_count)
    """
    # Rate limit between requests
    if request_count > 0:
        wait = random.uniform(2, 4)
        print(f"    [~] Throttle: waiting {wait:.1f}s...", flush=True)
        time.sleep(wait)

    projects, _ = _fetch_page(session, keyword, page=1)
    request_count += 1

    if projects:
        print(f"    Got {len(projects)} tenders from page 1", flush=True)

    return projects, request_count


def run_ag_scraper():
    """Search all keywords on Africa Gateway, deduplicate, return projects."""
    print("\n" + "=" * 60, flush=True)
    print("  Africa Gateway Scraper", flush=True)
    print("=" * 60, flush=True)

    session = requests.Session()
    seen = {}
    total_raw = 0
    request_count = 0

    keywords = get_search_keywords()
    print(f"[i] Keywords to search: {len(keywords)}", flush=True)
    for i, keyword in enumerate(keywords, 1):
        print(f"\n[>] [{i}/{len(keywords)}] Searching: '{keyword}'", flush=True)
        projects, request_count = fetch_keyword(session, keyword, request_count)
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

        print(f"    Running unique total: {len(seen)}", flush=True)

    all_projects = list(seen.values())
    print(f"\n[+] Total raw tenders: {total_raw}", flush=True)
    print(f"[+] Unique tenders after dedup: {len(all_projects)}", flush=True)

    return all_projects


# ── Standalone mode ──────────────────────────────────────────────────────────

def main():
    import json
    projects = run_ag_scraper()

    if projects:
        from shared_excel import save_to_excel
        save_to_excel(projects, filename="projects.xlsx")

        with open("ag_projects.json", "w", encoding="utf-8") as f:
            json.dump(projects, f, indent=2, ensure_ascii=False)
        print(f"[+] Also saved to 'ag_projects.json'")
    else:
        print("[!] No tenders found.")


if __name__ == "__main__":
    main()
