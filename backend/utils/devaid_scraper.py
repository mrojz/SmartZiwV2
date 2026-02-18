"""
DevelopmentAid tender scraper.

Searches https://www.developmentaid.org/api/frontend/tender/search
for each configured keyword. Returns open consulting tenders in
West/Central Africa matching cybersecurity-related terms.
"""

import time
import requests
from shared_excel import SEARCH_KEYWORDS, format_date

# ── DevelopmentAid API config ────────────────────────────────────────────────

SEARCH_URL = "https://www.developmentaid.org/api/frontend/tender/search"
BASE_URL = "https://www.developmentaid.org/tenders/view"

HEADERS = {
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Content-Type": "application/json",
    "Origin": "https://www.developmentaid.org",
    "Referer": "https://www.developmentaid.org/tenders/search",
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/144.0.0.0 Safari/537.36"
    ),
}

# West/Central Africa location IDs
LOCATION_IDS = [
    10, 12, 14, 11, 16, 17, 22, 21, 23, 30, 31, 32, 33, 34,
    37, 41, 42, 48, 49, 18, 53, 54, 56, 63,
]

# Default filter template
FILTER_TEMPLATE = {
    "keyword": {
        "searchedText": "",
        "searchedFields": [],
    },
    "locations": LOCATION_IDS,
    "sectors": [],
    "tenderTypes": [4],
    "donors": [],
    "contractingAuthorities": [],
    "statuses": [3],
    "modifiedAfter": None,
    "eligibilityAlias": "organisation",
    "postedFrom": None,
    "postedTill": None,
    "languages": [92, 101],
    "budgetInEuroRange": {"min": 0, "max": 20000000},
    "ownPosts": False,
    "locationIsStrict": False,
    "sectorsIsStrict": False,
    "typesIsStrict": False,
}

# REQUEST_DELAY = 2  # seconds between requests (uncomment if rate-limited)


# ── Helpers ──────────────────────────────────────────────────────────────────


def _build_payload(keyword: str, page: int = 1, page_size: int = 50) -> dict:
    """Build the search request payload for a given keyword."""
    filt = dict(FILTER_TEMPLATE)
    filt["keyword"] = {"searchedText": keyword, "searchedFields": []}
    return {
        "filter": filt,
        "sort": "relevance.desc",
        "pageSize": page_size,
        "pageNr": page,
    }


def _parse_item(item: dict) -> dict:
    """Convert a DevelopmentAid tender item to our standard project format."""
    slug = item.get("slug", "")
    tender_id = str(item.get("id", ""))

    return {
        "project_id": tender_id,
        "project_name": item.get("name", ""),
        "project_start_date": format_date(item.get("postedDate", "")),
        "project_end_date": format_date(item.get("deadline", "")),
        "project_description": item.get("name", ""),
        "project_sponsor": item.get("locationNames", ""),
        "source": "DevelopmentAid",
        "document_url": "",
        "project_url": f"{BASE_URL}/{tender_id}/{slug}" if slug else "",
        "matched_keywords": "",
    }


def fetch_keyword(session: requests.Session, keyword: str, request_count: int) -> tuple[list[dict], int]:
    """
    Search DevelopmentAid for a single keyword, handling pagination.
    Returns (projects, updated_request_count).
    """
    projects = []
    page = 1

    while True:
        # Rate limiting (uncomment if needed)
        # if request_count > 0:
        #     time.sleep(REQUEST_DELAY)
        request_count += 1

        payload = _build_payload(keyword, page=page)

        try:
            resp = session.post(SEARCH_URL, json=payload, headers=HEADERS, timeout=30)
            resp.raise_for_status()
            data = resp.json()
        except requests.RequestException as e:
            print(f"    [!] Request error on page {page}: {e}", flush=True)
            break

        items = data.get("items", [])
        total = data.get("total", 0)

        for item in items:
            projects.append(_parse_item(item))

        # Check if we need more pages
        fetched = page * 50
        if fetched >= total or not items:
            break
        page += 1

    return projects, request_count


# ── Main entry point ────────────────────────────────────────────────────────


def run_devaid_scraper():
    """Search all keywords on DevelopmentAid, deduplicate, return projects."""
    print("\n" + "=" * 60, flush=True)
    print("  DevelopmentAid Scraper", flush=True)
    print("  Searching open consulting tenders in West/Central Africa", flush=True)
    print("=" * 60, flush=True)

    session = requests.Session()
    seen = {}
    total_raw = 0
    request_count = 0

    for keyword in SEARCH_KEYWORDS:
        print(f"\n[>] Searching: '{keyword}'", flush=True)
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

    all_projects = list(seen.values())
    print(f"\n[+] Total raw tenders: {total_raw}", flush=True)
    print(f"[+] Unique tenders after dedup: {len(all_projects)}", flush=True)

    return all_projects


if __name__ == "__main__":
    results = run_devaid_scraper()
    print(f"\n[+] Final: {len(results)} unique projects")
    for p in results[:5]:
        print(f"  - [{p['project_id']}] {p['project_name'][:80]}")
