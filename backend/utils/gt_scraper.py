"""
Global Tenders Procurement Notices Scraper.

Scrapes https://www.globaltenders.com/gtsearch for live tenders.
Parses HTML results using BeautifulSoup.

Rate limiting: ~2 searches per minute, so we throttle heavily.
No browser required — plain HTTP requests.
"""

import time
import random
import requests
from bs4 import BeautifulSoup

from shared_excel import SEARCH_KEYWORDS, format_date, save_to_excel


BASE_URL = "https://www.globaltenders.com/gtsearch"
RESULTS_PER_PAGE = 10
MAX_PAGES = 20  # Safety cap per keyword

# Regions: Africa + Latin America
REGIONS = [
    "REG0101",  # Central Africa/Middle Africa Region
    "REG0102",  # East Africa/Eastern Africa Region
    "REG0103",  # North Africa/Northern Africa Region
    "REG0105",  # Sub-Saharan Africa Region
    "REG0106",  # West Africa Region
    "REG0204",  # South America Region
    "REG0205",  # Latin America Region
]

# Notice types: all relevant types
NOTICE_TYPES = "gpn,pp,spn,rei,ppn,acn,rfc"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.globaltenders.com/",
}


def _build_params(keyword, offset=0):
    """Build query params as list of tuples (supports duplicate keys for regions)."""
    params = [
        ("status", "menu"),
        ("limit", offset),
        ("keyword[]", keyword),
        ("notice_type", NOTICE_TYPES),
        ("tender_type", "live"),
        ("cpv", ""),
        ("bidding_type", ""),
        ("postrange", ""),
        ("deadline", ""),
        ("posting_id", ""),
        ("est_cost_condition", "greater_equal"),
        ("est_cost", ""),
    ]
    # Add each region as a separate param
    for region in REGIONS:
        params.append(("region_name[]", region))
    return params


def _fetch_page(session, keyword, offset=0):
    """Fetch a single page of results. Returns (tenders_html_list, total_results)."""
    params = _build_params(keyword, offset)

    for attempt in range(3):
        try:
            resp = session.get(
                BASE_URL, params=params, headers=HEADERS, timeout=30
            )
            if resp.status_code == 429:
                wait = 30 + random.uniform(5, 15)
                print(f"    [!] Rate limited (429), waiting {wait:.0f}s...")
                time.sleep(wait)
                continue
            if resp.status_code != 200:
                print(f"    [!] HTTP {resp.status_code}")
                return [], 0
            
            return _parse_page(resp.text)
            
        except Exception as e:
            if attempt < 2:
                wait = (2 ** attempt) * 5 + random.uniform(2, 5)
                print(f"    [!] Error (attempt {attempt + 1}), retrying in {wait:.0f}s: {e}")
                time.sleep(wait)
            else:
                print(f"    [!] Failed after 3 attempts: {e}")
                return [], 0
    
    return [], 0


def _parse_page(html):
    """Parse a page of HTML and extract tender data.
    
    Returns: (list_of_project_dicts, total_results_count)
    """
    soup = BeautifulSoup(html, "html.parser")
    
    # Extract total results count from <span id="h1">XX Results. </span>
    total = 0
    h1_span = soup.select_one("#h1")
    if h1_span:
        text = h1_span.get_text(strip=True)
        try:
            total = int(text.split("Results")[0].strip())
        except ValueError:
            pass
    
    # Find all tender items
    items = soup.select(".tender-wrap")
    projects = []
    
    for item in items:
        try:
            project = _parse_tender_item(item)
            if project:
                projects.append(project)
        except Exception as e:
            print(f"    [!] Error parsing item: {e}")
    
    return projects, total


def _parse_tender_item(item):
    """Parse a single tender-wrap div into a project dict."""
    # Tender ID from the div's id attribute (e.g. "tender_128783267")
    tender_id = item.get("id", "").replace("tender_", "")
    
    # Title: itemprop="name" inside the title-wrap
    title_elem = item.select_one("[itemprop='name']")
    title = title_elem.get_text(strip=True) if title_elem else ""
    
    # Country: itemprop="address"
    country_elem = item.select_one("[itemprop='address']")
    country = country_elem.get_text(strip=True) if country_elem else ""
    
    # Posting date: itemprop="startDate" (ISO date in content attribute)
    start_elem = item.select_one("[itemprop='startDate']")
    start_date = ""
    if start_elem:
        # Use the content attribute for clean ISO date
        iso_date = start_elem.get("content", "")
        if iso_date:
            start_date = format_date(iso_date)
        else:
            start_date = start_elem.get_text(strip=True)
    
    # Deadline: itemprop="endDate"
    end_elem = item.select_one("[itemprop='endDate']")
    end_date = ""
    if end_elem:
        iso_date = end_elem.get("content", "")
        if iso_date:
            end_date = format_date(iso_date)
        else:
            end_date = end_elem.get_text(strip=True)
    
    # Detail URL: itemprop="url"
    url_elem = item.select_one("[itemprop='url']")
    detail_url = url_elem.get("href", "") if url_elem else ""
    
    if not title:
        return None
    
    return {
        "project_id": tender_id,
        "project_name": "",
        "project_start_date": start_date,
        "project_end_date": end_date,
        "project_description": title,
        "project_sponsor": country,
        "source": "Global Tenders",
        "document_url": "",
        "project_url": detail_url,
    }


def fetch_keyword(session, keyword, request_count):
    """Fetch FIRST PAGE only for a single keyword. Returns list of projects.
    
    Args:
        session: requests.Session
        keyword: search keyword
        request_count: current total request count (for rate limiting)
    
    Returns:
        (projects, updated_request_count)
    """
    # Rate limit: wait ~30s between requests to stay under 2/min
    if request_count > 0:
        wait = random.uniform(32, 45)
        print(f"    [~] Throttle: waiting {wait:.0f}s (rate limit protection)...")
        time.sleep(wait)
    
    projects, total = _fetch_page(session, keyword, offset=0)
    request_count += 1
    
    if projects:
        print(f"    Got {len(projects)} items (total available: {total})")
    
    return projects or [], request_count


def run_gt_scraper():
    """Search all keywords on Global Tenders, deduplicate, return projects."""
    print("\n" + "=" * 60)
    print("  Global Tenders Scraper")
    print("  Rate limit: ~2 req/min — this will be slow")
    print("=" * 60)

    session = requests.Session()
    seen = {}
    total_raw = 0
    request_count = 0

    for keyword in SEARCH_KEYWORDS:
        print(f"\n[>] Searching: '{keyword}'")
        projects, request_count = fetch_keyword(session, keyword, request_count)
        print(f"    Found {len(projects)} tenders")
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
    print(f"\n[+] Total raw tenders: {total_raw}")
    print(f"[+] Unique tenders after dedup: {len(all_projects)}")

    return all_projects


# ── Standalone mode ──────────────────────────────────────────────────────────

def main():
    import json
    projects = run_gt_scraper()

    if projects:
        save_to_excel(projects, filename="projects.xlsx")

        with open("gt_projects.json", "w", encoding="utf-8") as f:
            json.dump(projects, f, indent=2, ensure_ascii=False)
        print(f"[+] Also saved to 'gt_projects.json'")
    else:
        print("[!] No tenders found.")


if __name__ == "__main__":
    main()
