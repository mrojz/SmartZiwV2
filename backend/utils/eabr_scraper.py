"""
EABR procurement notices scraper.

Scrapes the rendered Oracle Procurement notices table and returns the current
visible notice rows in the shared project schema for downstream AI filtering.
"""

from __future__ import annotations

import re
import time
from datetime import datetime

import requests
from bs4 import BeautifulSoup


LIST_URL = (
    "https://iaayou.fa.ocs.oraclecloud.com/fscmUI/faces/NegotiationAbstracts"
    "?prcBuId=300000003621906"
)
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": LIST_URL,
}


def _normalize_space(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "")).strip()


def _parse_date(value: str) -> str:
    text = _normalize_space(value)
    if not text:
        return ""
    for fmt in ("%m/%d/%y %I:%M %p", "%m/%d/%Y %I:%M %p", "%m/%d/%y", "%m/%d/%Y"):
        try:
            return datetime.strptime(text, fmt).strftime("%m/%d/%Y")
        except ValueError:
            continue
    return ""


def _build_session() -> requests.Session:
    session = requests.Session()
    session.headers.update(HEADERS)
    return session


def _fetch_listing(session: requests.Session) -> str:
    for attempt in range(3):
        try:
            response = session.get(LIST_URL, timeout=40)
            response.raise_for_status()
            return response.text
        except Exception as exc:
            if attempt == 2:
                print(f"    [!] EABR request failed: {exc}", flush=True)
                return ""
            time.sleep(1.5 * (attempt + 1))
    return ""


def _parse_listing(html: str) -> list[dict]:
    if not html:
        return []
    soup = BeautifulSoup(html, "html.parser")

    results_table = None
    for table in soup.find_all("table"):
        label = _normalize_space(table.get("summary", "") or table.get("aria-label", ""))
        if label.lower() == "search results":
            results_table = table
            break
    if not results_table:
        print("    [!] EABR search results table not found", flush=True)
        return []

    projects: list[dict] = []
    for row in results_table.select("tr"):
        cells = row.find_all("td")
        if len(cells) < 8:
            continue

        negotiation_id = _normalize_space(cells[0].get_text(" ", strip=True))
        title = _normalize_space(cells[1].get_text(" ", strip=True))
        negotiation_type = _normalize_space(cells[2].get_text(" ", strip=True))
        status = _normalize_space(cells[3].get_text(" ", strip=True))
        posting_date = _parse_date(cells[4].get_text(" ", strip=True))
        open_date = _parse_date(cells[5].get_text(" ", strip=True))
        close_date = _parse_date(cells[6].get_text(" ", strip=True))

        if not negotiation_id or not title:
            continue

        description_parts = [title]
        if negotiation_type:
            description_parts.append(f"Type: {negotiation_type}")
        if status:
            description_parts.append(f"Status: {status}")
        if open_date:
            description_parts.append(f"Open date: {open_date}")

        projects.append(
            {
                "project_id": f"EABR-{negotiation_id}",
                "project_name": title,
                "project_description": " | ".join(description_parts),
                "project_start_date": posting_date or open_date,
                "project_end_date": close_date,
                "project_sponsor": "EABR",
                "source": "EABR",
                "document_url": "",
                "project_url": LIST_URL,
                "notice_status": status,
                "negotiation_type": negotiation_type,
                "ai_verified": "",
                "decision": "",
            }
        )
    return projects


def run_eabr_scraper() -> list[dict]:
    print("\n" + "=" * 60, flush=True)
    print("  EABR Procurement Notices Scraper", flush=True)
    print("=" * 60, flush=True)

    session = _build_session()
    html = _fetch_listing(session)
    projects = _parse_listing(html)
    print(f"[+] EABR notices found: {len(projects)}", flush=True)
    return projects
