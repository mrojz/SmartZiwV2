"""
World Bank Procurement Notices Scraper.

Uses the official POST API at:
  https://search.worldbank.org/api/v2/procnotices

Only fetches notices with deadlines >= today (via deadline_strdate).
Sorted by submission_deadline_date descending.

No browser or proxy required — plain HTTP requests.
"""

import json
import time
import random
from datetime import date
import requests

from shared_excel import SEARCH_KEYWORDS, get_search_keywords, format_date, save_to_excel


API_URL = "https://search.worldbank.org/api/v2/procnotices"
PROJECT_API_URL = "https://search.worldbank.org/api/v2/projects"
ROWS_PER_PAGE = 50

# Headers matching the real browser request
HEADERS = {
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Content-Type": "text/plain",
    "Origin": "https://projects.worldbank.org",
    "Referer": "https://projects.worldbank.org/",
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36"
    ),
}

# Fields to request from the API
FIELDS = ",".join([
    "market_approach_name",
    "market_approach_region_name",
    "procurement_major_sector_name",
    "id",
    "procurement_group_desc",
    "submission_deadline_date",
    "bid_description",
    "project_ctry_name",
    "project_name",
    "notice_type",
    "notice_status",
    "notice_lang_name",
    "submission_date",
    "noticedate",
    "project_id",
])

# Facets to request
FACETS = ",".join([
    "market_approach_name_exact",
    "market_approach_region_name_exact",
    "procurement_major_sector_name_exact",
    "procurement_group_desc_exact",
    "notice_type_exact",
    "procurement_method_code_exact",
    "procurement_method_name_exact",
    "project_ctry_code_exact",
    "project_ctry_name_exact",
    "regionname_exact",
    "rregioncode",
    "project_id",
    "sector.sector_description",
    "sector.sector_code",
])

# Notice types to include
NOTICE_TYPES = "^".join([
    "Invitation for Bids",
    "Invitation for Prequalification",
    "Request for Expression of Interest",
])


def fetch_notices(keyword, max_pages=10):
    """Fetch all procurement notices matching a keyword, with pagination.
    
    Uses POST with deadline_strdate = today to only get active notices.
    """
    all_notices = []
    offset = 0
    today_str = date.today().strftime("%Y-%m-%d")

    for page in range(max_pages):
        params = {
            "format": "json",
            "fct": FACETS,
            "fl": FIELDS,
            "srt": "submission_deadline_date",
            "order": "desc",
            "apilang": "en",
            "rows": ROWS_PER_PAGE,
            "srce": "both",
            "os": offset,
            "notice_type_exact": NOTICE_TYPES,
            "deadline_strdate": today_str,
            "qterm": keyword,
        }

        for attempt in range(3):
            try:
                resp = requests.post(
                    API_URL, params=params, headers=HEADERS, timeout=30
                )
                if resp.status_code == 429:
                    wait = (2 ** attempt) + random.uniform(1, 3)
                    print(f"    [!] Rate limited, waiting {wait:.1f}s...")
                    time.sleep(wait)
                    continue
                resp.raise_for_status()
                data = resp.json()
                break
            except Exception as e:
                if attempt < 2:
                    wait = (2 ** attempt) + random.uniform(0.5, 1.5)
                    print(f"    [!] API error (attempt {attempt + 1}), retrying in {wait:.1f}s: {e}")
                    time.sleep(wait)
                else:
                    print(f"    [!] API error (page {page + 1}): {e}")
                    return all_notices

        notices = data.get("procnotices", [])
        total = int(data.get("total", 0))

        if not notices:
            break

        all_notices.extend(notices)
        offset += ROWS_PER_PAGE

        if offset >= total:
            break

        time.sleep(random.uniform(0.5, 1.5))

    return all_notices


def fetch_project_details(project_ids):
    """Fetch detail info for a list of project IDs from the WB Projects API.
    
    Returns a dict mapping project_id -> {boardapprovaldate, closingdate, ...}
    """
    details = {}
    unique_ids = list(set(pid for pid in project_ids if pid))

    if not unique_ids:
        return details

    print(f"\n[>] Fetching details for {len(unique_ids)} unique projects...")

    for i, pid in enumerate(unique_ids):
        try:
            params = {
                "format": "json",
                "id": pid,
                "fields": "project_name,boardapprovaldate,closingdate,countryname,status,totalamt",
            }
            resp = requests.get(PROJECT_API_URL, params=params, timeout=15)
            if resp.status_code == 429:
                wait = random.uniform(3, 6)
                print(f"    [!] Rate limited, waiting {wait:.1f}s...")
                time.sleep(wait)
                resp = requests.get(PROJECT_API_URL, params=params, timeout=15)
            resp.raise_for_status()
            data = resp.json()

            projects_data = data.get("projects", {})
            if pid in projects_data:
                details[pid] = projects_data[pid]
        except Exception as e:
            print(f"    [!] Error fetching {pid}: {e}")

        if (i + 1) % 50 == 0:
            print(f"    Fetched {i + 1}/{len(unique_ids)}...")

        time.sleep(random.uniform(0.2, 0.6))

    print(f"    Fetched details for {len(details)}/{len(unique_ids)} projects")
    return details


def notice_to_project(notice):
    """Convert a raw API notice dict to our unified project dict."""
    project_id = notice.get("project_id", "")

    project_url = ""
    if project_id:
        project_url = f"https://projects.worldbank.org/en/projects-operations/project-detail/{project_id}"

    # noticedate = publication date, submission_deadline_date = due date
    pub_date = format_date(notice.get("noticedate", ""))
    due_date = format_date(notice.get("submission_deadline_date", ""))

    return {
        "project_id": project_id,
        "project_name": notice.get("project_name", ""),
        "project_start_date": pub_date,
        "project_end_date": due_date,
        "project_description": notice.get("bid_description", ""),
        "project_sponsor": notice.get("project_ctry_name", ""),
        "source": "World Bank",
        "document_url": "",
        "project_url": project_url,
    }


def enrich_with_details(projects, details):
    """Fill in missing dates from project detail API."""
    enriched = 0
    for p in projects:
        pid = p.get("project_id", "")
        if pid not in details:
            continue

        detail = details[pid]

        if not p.get("project_end_date"):
            closing = detail.get("closingdate", "")
            if closing:
                p["project_end_date"] = format_date(closing)
                enriched += 1

        if not p.get("project_start_date"):
            approval = detail.get("boardapprovaldate", "")
            if approval:
                p["project_start_date"] = format_date(approval)
                enriched += 1

    if enriched:
        print(f"    [+] Enriched {enriched} date fields from project details")


def run_wb_scraper():
    """Search all keywords, deduplicate, and return unified project list."""
    print("\n" + "=" * 60)
    print("  World Bank Procurement Notices Scraper")
    print(f"  Deadline filter: >= {date.today().strftime('%Y-%m-%d')}")
    print("=" * 60)

    seen = {}
    total_raw = 0

    keywords = get_search_keywords()
    for keyword in keywords:
        print(f"\n[>] Searching: '{keyword}'")
        notices = fetch_notices(keyword)
        print(f"    Found {len(notices)} notices")
        total_raw += len(notices)

        for notice in notices:
            project = notice_to_project(notice)
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

        # Throttle between keyword searches
        time.sleep(random.uniform(1.0, 3.0))

    all_projects = list(seen.values())
    print(f"\n[+] Total raw notices: {total_raw}")
    print(f"[+] Unique projects after dedup: {len(all_projects)}")

    return all_projects


# ── Standalone mode ──────────────────────────────────────────────────────────

def main():
    projects = run_wb_scraper()

    if projects:
        save_to_excel(projects, filename="projects.xlsx")

        with open("wb_projects.json", "w", encoding="utf-8") as f:
            json.dump(projects, f, indent=2, ensure_ascii=False)
        print(f"[+] Also saved to 'wb_projects.json'")
    else:
        print("[!] No projects found.")


if __name__ == "__main__":
    main()
