"""
GIZ Vergabemarktplatz Procurement Scraper.

Scrapes https://ausschreibungen.giz.de for cybersecurity-related tenders.
Sends POST to extended search with each keyword, parses HTML table results.
"""

import re
import time

import requests
from bs4 import BeautifulSoup

from shared_excel import SEARCH_KEYWORDS, format_date

BASE_URL = "https://ausschreibungen.giz.de"
SEARCH_URL = f"{BASE_URL}/Satellite/common/project/search.do?method=showExtendedSearch&fromExternal=true"
DETAIL_BASE = f"{BASE_URL}/Satellite/public/company/projectForwarding.do?pid="

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Content-Type": "application/x-www-form-urlencoded",
    "Origin": BASE_URL,
    "Referer": SEARCH_URL,
}


def _search_keyword(session: requests.Session, keyword: str) -> list[dict]:
    """
    Search GIZ for a single keyword. Returns list of project dicts.
    """
    data = {"externalSearchText": keyword}

    try:
        resp = session.post(
            SEARCH_URL,
            headers=HEADERS,
            cookies={"locale": "ENGLISH"},
            data=data,
            timeout=30,
        )
        resp.raise_for_status()
    except requests.RequestException as e:
        print(f"    [!] Request failed: {e}")
        return []

    return _parse_results(resp.text, keyword)


def _parse_results(html: str, keyword: str) -> list[dict]:
    """Parse the GIZ search results HTML table."""
    soup = BeautifulSoup(html, "html.parser")
    table = soup.find("table", class_="csx-new-table")
    if not table:
        return []

    rows = table.find_all("tr")
    projects = []

    for row in rows:
        cells = row.find_all("td")
        if len(cells) < 5:
            continue

        # Skip the pagination row
        browse_div = row.find("div", class_="browsePages")
        if browse_div:
            continue

        published = cells[0].get_text(strip=True)
        deadline = cells[1].get_text(strip=True)
        description = cells[2].get_text(strip=True)
        notice_type = cells[3].get_text(strip=True)
        authority = cells[4].get_text(strip=True)

        # Extract project URL from Action column (cell 5)
        project_url = ""
        project_id = ""

        if len(cells) > 5:
            action_link = cells[5].find("a")
            if action_link and action_link.get("href"):
                href = action_link["href"]
                project_url = BASE_URL + href if href.startswith("/") else href
                pid_match = re.search(r"pid=(\d+)", href)
                if pid_match:
                    project_id = f"GIZ-{pid_match.group(1)}"

        # Extract notice ID from the description text (e.g. "81323043-Terms of...")
        if not project_id:
            id_match = re.match(r"^(\w+\d+)-", description)
            if id_match:
                project_id = f"GIZ-{id_match.group(1)}"
            else:
                project_id = f"GIZ-{hash(description) % 100000}"

        projects.append({
            "project_id": project_id,
            "project_name": description[:200],
            "project_description": description,
            "project_start_date": _format_giz_date(published),
            "project_end_date": _format_giz_date(deadline),
            "project_sponsor": authority,
            "source": "GIZ",
            "project_url": project_url,
            "document_url": "",
            "matched_keywords": keyword,
            "ai_verified": "",
            "decision": "",
        })

    return projects


def _format_giz_date(date_str: str) -> str:
    """Convert GIZ date format (DD.MM.YYYY) to standard format."""
    if not date_str:
        return ""
    parts = date_str.strip().split(".")
    if len(parts) == 3:
        try:
            return f"{parts[2]}-{parts[1]}-{parts[0]}"  # YYYY-MM-DD
        except (IndexError, ValueError):
            pass
    return date_str


def run_giz_scraper() -> list[dict]:
    """Search all keywords on GIZ, deduplicate, return projects."""
    print("\n" + "=" * 60)
    print("  GIZ Vergabemarktplatz Scraper")
    print("=" * 60)

    session = requests.Session()
    seen: dict[tuple, dict] = {}
    total_raw = 0

    for i, keyword in enumerate(SEARCH_KEYWORDS, 1):
        print(f"\n[{i}/{len(SEARCH_KEYWORDS)}] Searching: '{keyword}'")
        projects = _search_keyword(session, keyword)
        print(f"    Found {len(projects)} notices")
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
                seen[dedup_key] = project

        # Be polite to the server
        if i < len(SEARCH_KEYWORDS):
            time.sleep(2)

    all_projects = list(seen.values())
    print(f"\n[+] Total raw GIZ notices: {total_raw}")
    print(f"[+] Unique GIZ notices after dedup: {len(all_projects)}")

    return all_projects


# ── Standalone mode ──────────────────────────────────────────────────────────

def main():
    from shared_excel import save_to_excel
    projects = run_giz_scraper()
    if projects:
        save_to_excel(projects, filename="giz_projects.xlsx")
        print(f"\n[+] Saved {len(projects)} projects to giz_projects.xlsx")
    else:
        print("\n[i] No projects found.")


if __name__ == "__main__":
    main()
