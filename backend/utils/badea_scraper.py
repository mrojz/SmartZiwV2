"""
BADEA procurement notices scraper.

Searches the BADEA procurement notices page with each configured keyword,
walks all result pages for that keyword, and returns deduplicated notice rows.
"""

from __future__ import annotations

import re
import time
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

from shared_excel import get_search_keywords, format_date


BASE_URL = "https://www.badea.org"
SEARCH_URL = f"{BASE_URL}/procurement-notices-2/"
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": SEARCH_URL,
}
MAX_PAGES_FALLBACK = 1
MAX_PAGES_CAP = 50
MAX_RESULTS_RE = re.compile(r'"max_num_pages"\s*:\s*(\d+)', re.IGNORECASE)
TITLE_SELECTOR = ".elementor-widget-theme-post-title h1, .elementor-widget-theme-post-title .elementor-heading-title"


def _normalize_space(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "")).strip()


def _build_session() -> requests.Session:
    session = requests.Session()
    session.headers.update(HEADERS)
    return session


def _fetch_results_page(session: requests.Session, keyword: str, page_number: int) -> str:
    params = {
        "jsf": "epro-loop-builder:dataGrid",
        "_s": keyword,
        "pagenum": page_number,
    }
    for attempt in range(3):
        try:
            response = session.get(SEARCH_URL, params=params, timeout=30)
            response.raise_for_status()
            return response.text
        except Exception as exc:
            if attempt == 2:
                print(f"    [!] BADEA request failed for '{keyword}' page {page_number}: {exc}", flush=True)
                return ""
            time.sleep(1.2 * (attempt + 1))
    return ""


def _extract_max_pages(html: str) -> int:
    if not html:
        return MAX_PAGES_FALLBACK
    match = MAX_RESULTS_RE.search(html)
    if not match:
        return MAX_PAGES_FALLBACK
    try:
        value = int(match.group(1))
    except ValueError:
        return MAX_PAGES_FALLBACK
    return max(1, min(value, MAX_PAGES_CAP))


def _extract_date_fields(item: BeautifulSoup) -> tuple[str, str]:
    labels = [
        _normalize_space(node.get_text(" ", strip=True)).lower()
        for node in item.select(".elementor-widget-heading .elementor-heading-title, .elementor-heading-title")
        if _normalize_space(node.get_text(" ", strip=True))
    ]

    date_values = []
    for node in item.select("span.elementor-heading-title, .elementor-widget-container span"):
        text = _normalize_space(node.get_text(" ", strip=True))
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
            date_values.append(text)

    start_date = format_date(date_values[0]) if len(date_values) >= 1 else ""
    end_date = format_date(date_values[1]) if len(date_values) >= 2 else (format_date(date_values[0]) if labels.count("end date") and date_values else "")
    return start_date, end_date


def _parse_results(html: str, keyword: str) -> list[dict]:
    if not html or "Sorry, nothing to see here" in html:
        return []

    soup = BeautifulSoup(html, "html.parser")
    projects: list[dict] = []
    for item in soup.select(".e-loop-item"):
        classes = item.get("class", [])
        post_id = ""
        for cls in classes:
            if cls.startswith("post-"):
                post_id = cls.split("-", 1)[1]
                break

        title_node = item.select_one(TITLE_SELECTOR)
        title = _normalize_space(title_node.get_text(" ", strip=True) if title_node else "")
        if not title:
            continue

        start_date, end_date = _extract_date_fields(item)
        download_link = item.select_one("a[href]")
        document_url = urljoin(BASE_URL, download_link.get("href", "")) if download_link else ""
        project_url = document_url or SEARCH_URL

        projects.append(
            {
                "project_id": f"BADEA-{post_id}" if post_id else f"BADEA-{abs(hash(title))}",
                "project_name": title,
                "project_start_date": start_date,
                "project_end_date": end_date,
                "project_description": title,
                "project_sponsor": "BADEA",
                "source": "BADEA",
                "document_url": document_url,
                "project_url": project_url,
                "matched_keywords": keyword,
                "ai_verified": "",
                "decision": "",
            }
        )
    return projects


def _search_keyword(session: requests.Session, keyword: str) -> list[dict]:
    first_html = _fetch_results_page(session, keyword, 1)
    max_pages = _extract_max_pages(first_html)
    print(f"    [>] BADEA pages for '{keyword}': {max_pages}", flush=True)

    projects = _parse_results(first_html, keyword)
    for page_number in range(2, max_pages + 1):
        html = _fetch_results_page(session, keyword, page_number)
        page_projects = _parse_results(html, keyword)
        projects.extend(page_projects)
        time.sleep(0.4)
    return projects


def run_badea_scraper() -> list[dict]:
    print("\n" + "=" * 60, flush=True)
    print("  BADEA Procurement Notices Scraper", flush=True)
    print("=" * 60, flush=True)

    session = _build_session()
    seen: dict[tuple[str, str], dict] = {}
    total_raw = 0

    keywords = get_search_keywords()
    for idx, keyword in enumerate(keywords, 1):
        print(f"\n[{idx}/{len(keywords)}] Searching BADEA: '{keyword}'", flush=True)
        projects = _search_keyword(session, keyword)
        print(f"    Found {len(projects)} notices", flush=True)
        total_raw += len(projects)

        for project in projects:
            dedup_key = (project["project_id"], project["project_name"])
            if dedup_key in seen:
                existing = seen[dedup_key]
                keyword_list = [value for value in existing.get("matched_keywords", "").split(", ") if value]
                if keyword not in keyword_list:
                    keyword_list.append(keyword)
                    existing["matched_keywords"] = ", ".join(keyword_list)
            else:
                seen[dedup_key] = project

        if idx < len(keywords):
            time.sleep(1.0)

    all_projects = list(seen.values())
    print(f"\n[+] Total raw BADEA notices: {total_raw}", flush=True)
    print(f"[+] Unique BADEA notices after dedup: {len(all_projects)}", flush=True)
    return all_projects
