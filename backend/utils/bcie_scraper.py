"""
BCIE procurement notices scraper.

Scrapes the BCIE procurement notice listing page, collects all notice rows,
and enriches each notice from its detail page before handing the results to
the shared AI verification pipeline.
"""

from __future__ import annotations

import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup


BASE_URL = "https://adquisiciones.bcie.org"
LIST_URL = f"{BASE_URL}/en/procurement-notice"
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": LIST_URL,
}
DETAIL_WORKERS = 5
DATE_LABEL_RE = re.compile(r"^(country|reception date|line)\s*:\s*(.+)$", re.IGNORECASE)


def _normalize_space(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "")).strip()


def _parse_date(value: str) -> str:
    text = _normalize_space(value)
    if not text:
        return ""
    for fmt in ("%d/%m/%Y", "%d-%b-%Y", "%d %b %Y", "%d %B %Y"):
        try:
            return datetime.strptime(text, fmt).strftime("%m/%d/%Y")
        except ValueError:
            continue
    return ""


def _build_session() -> requests.Session:
    session = requests.Session()
    session.headers.update(HEADERS)
    return session


def _fetch_html(session: requests.Session, url: str) -> str:
    for attempt in range(3):
        try:
            response = session.get(url, timeout=30)
            response.raise_for_status()
            return response.text
        except Exception as exc:
            if attempt == 2:
                print(f"    [!] BCIE request failed for {url}: {exc}", flush=True)
                return ""
            time.sleep(1.5 * (attempt + 1))
    return ""


def _parse_listing(html: str) -> list[dict]:
    if not html:
        return []
    soup = BeautifulSoup(html, "html.parser")
    table = soup.select_one("#customtables")
    if not table:
        print("    [!] BCIE listing table '#customtables' not found", flush=True)
        return []

    projects: list[dict] = []
    for row in table.select("tbody tr"):
        cells = row.find_all("td")
        if len(cells) < 6:
            continue

        project_id = _normalize_space(cells[0].get_text(" ", strip=True))
        link = cells[1].find("a", href=True)
        project_name = _normalize_space(link.get_text(" ", strip=True) if link else cells[1].get_text(" ", strip=True))
        project_url = urljoin(BASE_URL, link.get("href", "").strip()) if link else LIST_URL
        project_description = _normalize_space(link.get("title", "") if link else "")
        country = _normalize_space(cells[2].get_text(" ", strip=True))
        publication_date = _parse_date(cells[3].get_text(" ", strip=True))
        reception_date = _parse_date(cells[4].get_text(" ", strip=True))
        remaining_days = _normalize_space(cells[5].get_text(" ", strip=True))

        if not project_id or not project_name:
            continue

        projects.append(
            {
                "project_id": f"BCIE-{project_id}",
                "project_name": project_name,
                "project_description": project_description or project_name,
                "project_start_date": publication_date,
                "project_end_date": reception_date,
                "project_sponsor": country,
                "source": "BCIE",
                "document_url": "",
                "project_url": project_url,
                "remaining_days": remaining_days,
                "ai_verified": "",
                "decision": "",
            }
        )
    return projects


def _extract_listing_page_urls(html: str) -> list[str]:
    if not html:
        return [LIST_URL]
    soup = BeautifulSoup(html, "html.parser")
    urls = [LIST_URL]
    seen = {LIST_URL}
    for link in soup.select("#customtables_paginate a[href], .pagination a[href], nav[aria-label*='pagination' i] a[href]"):
        href = link.get("href", "").strip()
        if not href:
            continue
        page_url = urljoin(LIST_URL, href)
        if page_url in seen:
            continue
        seen.add(page_url)
        urls.append(page_url)
    return urls


def _extract_detail_metadata(node) -> dict[str, str]:
    info: dict[str, str] = {}
    if not node:
        return info

    text = _normalize_space(node.get_text(" ", strip=True))
    if not text:
        return info

    for part in text.split("|"):
        piece = _normalize_space(part)
        match = DATE_LABEL_RE.match(piece)
        if not match:
            continue
        key = match.group(1).strip().lower()
        value = _normalize_space(match.group(2))
        info[key] = value
    return info


def _extract_detail_description(container: BeautifulSoup) -> str:
    if not container:
        return ""

    notice_heading = None
    for heading in container.select("h1, h2, h3, h4"):
        if _normalize_space(heading.get_text(" ", strip=True)).lower() == "notice":
            notice_heading = heading
            break

    if notice_heading:
        parts: list[str] = []
        for sibling in notice_heading.find_next_siblings():
            if getattr(sibling, "name", None) in {"h1", "h2", "h3", "h4"}:
                break
            text = _normalize_space(sibling.get_text(" ", strip=True))
            if len(text) >= 30:
                parts.append(text)
        if parts:
            return "\n\n".join(parts)

    paragraphs = []
    for node in container.select("p"):
        text = _normalize_space(node.get_text(" ", strip=True))
        if len(text) >= 30:
            paragraphs.append(text)
    if paragraphs:
        return "\n\n".join(paragraphs[:8])

    return ""


def _extract_document_url(container: BeautifulSoup, detail_url: str) -> str:
    if not container:
        return ""
    for link in container.select("a[href]"):
        href = link.get("href", "").strip()
        if not href:
            continue
        lowered = href.lower()
        if any(token in lowered for token in (".pdf", ".doc", ".docx", ".xls", ".xlsx", ".zip")):
            return urljoin(detail_url, href)
    return ""


def _fetch_detail(session: requests.Session, item: dict) -> dict:
    detail_url = item.get("project_url", "")
    if not detail_url:
        return item

    html = _fetch_html(session, detail_url)
    if not html:
        return item

    soup = BeautifulSoup(html, "html.parser")
    content = soup.select_one(".region-content, main, #page-content") or soup
    title_node = content.select_one("h2, h1")
    meta_node = title_node.find_next(["p", "div"]) if title_node else None
    detail_meta = _extract_detail_metadata(meta_node)
    description = _extract_detail_description(content)
    document_url = _extract_document_url(content, detail_url)

    enriched = item.copy()
    if title_node:
        detail_title = _normalize_space(title_node.get_text(" ", strip=True))
        if detail_title:
            enriched["project_name"] = detail_title
    if detail_meta.get("country"):
        enriched["project_sponsor"] = detail_meta["country"]
    if detail_meta.get("reception date"):
        parsed_deadline = _parse_date(detail_meta["reception date"])
        if parsed_deadline:
            enriched["project_end_date"] = parsed_deadline
    if description:
        enriched["project_description"] = description
    if document_url:
        enriched["document_url"] = document_url
    return enriched


def run_bcie_scraper() -> list[dict]:
    print("\n" + "=" * 60, flush=True)
    print("  BCIE Procurement Notices Scraper", flush=True)
    print("=" * 60, flush=True)

    session = _build_session()
    html = _fetch_html(session, LIST_URL)
    page_urls = _extract_listing_page_urls(html)
    print(f"[i] BCIE listing pages discovered: {len(page_urls)}", flush=True)

    projects: list[dict] = []
    seen_ids: set[str] = set()
    for page_url in page_urls:
        page_html = html if page_url == LIST_URL else _fetch_html(session, page_url)
        for project in _parse_listing(page_html):
            dedup_key = project.get("project_id", "")
            if dedup_key in seen_ids:
                continue
            seen_ids.add(dedup_key)
            projects.append(project)

    print(f"[+] BCIE listing rows found: {len(projects)}", flush=True)
    if not projects:
        return []

    enriched_projects: list[dict] = []
    with ThreadPoolExecutor(max_workers=min(DETAIL_WORKERS, len(projects))) as executor:
        futures = {
            executor.submit(_fetch_detail, _build_session(), project): project
            for project in projects
        }
        for future in as_completed(futures):
            try:
                enriched_projects.append(future.result())
            except Exception as exc:
                fallback = futures[future]
                print(f"    [!] BCIE detail enrichment failed for {fallback.get('project_url', '')}: {exc}", flush=True)
                enriched_projects.append(fallback)

    enriched_projects.sort(key=lambda item: item.get("project_id", ""))
    print(f"[+] BCIE total notices after enrichment: {len(enriched_projects)}", flush=True)
    return enriched_projects
