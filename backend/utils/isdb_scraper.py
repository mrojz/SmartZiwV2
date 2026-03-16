"""
IsDB Procurement Tenders scraper.

Scrapes https://www.isdb.org/project-procurement/tenders without search filters:
  - walks all pagination pages
  - keeps only active tenders
  - fetches each active tender detail page for richer description/metadata

Returns projects in the unified project schema consumed by the existing
AI verification/enrichment pipeline in backend/main.py.
"""

from __future__ import annotations

import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from urllib.parse import urljoin, urlparse, parse_qs

import requests
from bs4 import BeautifulSoup

from shared_excel import format_date


BASE_URL = "https://www.isdb.org"
LIST_URL = f"{BASE_URL}/project-procurement/tenders"
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
ACTIVE_STATUS_RE = re.compile(r"\b(active|open|current|live)\b", re.IGNORECASE)
LABEL_MAP = {
    "issue date": "issue_date",
    "last date of submission": "submission_date",
    "notice type": "notice_type",
    "tender type": "tender_type",
    "country": "country",
    "country / beneficiary": "country",
    "documents": "documents",
}


def _normalize_space(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "")).strip()


def _parse_date(value: str) -> str:
    text = _normalize_space(value)
    if not text:
        return ""
    for fmt in ("%d %B %Y", "%d %b %Y", "%B %d, %Y", "%b %d, %Y"):
        try:
            return datetime.strptime(text, fmt).strftime("%m/%d/%Y")
        except ValueError:
            continue
    return format_date(text)


def _is_active_status(value: str) -> bool:
    text = _normalize_space(value)
    if not text:
        return True
    return bool(ACTIVE_STATUS_RE.search(text))


def _build_session() -> requests.Session:
    session = requests.Session()
    session.headers.update(HEADERS)
    return session


def _fetch_listing_page(session: requests.Session, page: int) -> str:
    params = {"status": "active", "page": page}
    for attempt in range(3):
        try:
            response = session.get(LIST_URL, params=params, timeout=30)
            response.raise_for_status()
            return response.text
        except Exception as exc:
            if attempt == 2:
                print(f"    [!] IsDB page {page} failed: {exc}", flush=True)
                return ""
            time.sleep(1.5 * (attempt + 1))
    return ""


def _parse_listing_page(html: str) -> list[dict]:
    if not html:
        return []
    soup = BeautifulSoup(html, "html.parser")
    items = []
    for article in soup.select("article.display-teaser[data-nid]"):
        title_link = article.select_one(".field-title h2 a")
        if not title_link:
            continue

        status_text = _normalize_space(
            article.select_one(".field--name-field-tender-status") and
            article.select_one(".field--name-field-tender-status").get_text(" ", strip=True)
        )
        if status_text and not _is_active_status(status_text):
            continue

        nid = (article.get("data-nid") or "").strip()
        title = _normalize_space(title_link.get_text(" ", strip=True))
        detail_url = urljoin(BASE_URL, title_link.get("href", ""))
        tender_type = _normalize_space(
            article.select_one(".field--name-field-tender-type") and
            article.select_one(".field--name-field-tender-type").get_text(" ", strip=True)
        )
        country = _normalize_space(
            article.select_one(".field--name-field-world-country") and
            article.select_one(".field--name-field-world-country").get_text(" ", strip=True)
        )
        close_time = article.select_one(".field--name-field-close-date time")
        close_date = _parse_date(close_time.get_text(" ", strip=True) if close_time else "")

        if not title or not detail_url:
            continue

        items.append(
            {
                "nid": nid,
                "project_id": f"ISDB-{nid}" if nid else f"ISDB-{abs(hash(detail_url))}",
                "project_name": title,
                "project_start_date": "",
                "project_end_date": close_date,
                "project_description": "",
                "project_sponsor": country,
                "source": "IsDB",
                "document_url": "",
                "project_url": detail_url,
                "status_text": status_text or "Active",
                "tender_type": tender_type,
            }
        )
    return items


def _extract_total_pages(html: str) -> int:
    if not html:
        return 1
    soup = BeautifulSoup(html, "html.parser")
    page_numbers: set[int] = {0}

    for link in soup.select("ul.pagination a[href], .pager a[href], nav[aria-label*='pagination' i] a[href]"):
        href = link.get("href", "").strip()
        if not href:
            continue
        try:
            query = parse_qs(urlparse(urljoin(BASE_URL, href)).query)
            raw_page = query.get("page", [None])[0]
            if raw_page is None:
                continue
            page_numbers.add(int(raw_page))
        except Exception:
            continue

    # IsDB pagination is zero-based: page=0 is the first page.
    return max(page_numbers) + 1


def _extract_field_map(soup: BeautifulSoup) -> dict:
    info: dict[str, str] = {}
    for field in soup.select(".field"):
        label_el = field.select_one(".field__label, .field--label")
        if not label_el:
            continue
        label = _normalize_space(label_el.get_text(" ", strip=True)).rstrip(":").lower()
        mapped = LABEL_MAP.get(label)
        if not mapped:
            continue
        value_container = field.select_one(".field__item, .field__items, .field__content") or field
        value_text = _normalize_space(value_container.get_text(" ", strip=True))
        if value_text:
            info[mapped] = value_text
    return info


def _extract_document_url(soup: BeautifulSoup, detail_url: str) -> str:
    for link in soup.select("a[href]"):
        href = link.get("href", "").strip()
        if not href:
            continue
        lowered = href.lower()
        if lowered.endswith(".pdf") or "/sites/" in lowered:
            return urljoin(detail_url, href)
    return ""


def _extract_description(soup: BeautifulSoup) -> str:
    selectors = [
        ".field--name-body",
        ".field--name-description",
        ".field--name-field-description",
        ".region-content .content",
        "main .field__item",
    ]
    for selector in selectors:
        for node in soup.select(selector):
            text = _normalize_space(node.get_text(" ", strip=True))
            if len(text) >= 80:
                return text

    candidates: list[str] = []
    for node in soup.select("main p, main div"):
        text = _normalize_space(node.get_text(" ", strip=True))
        if len(text) >= 80:
            candidates.append(text)
    if candidates:
        candidates.sort(key=len, reverse=True)
        return candidates[0]
    return ""


def _fetch_detail(session: requests.Session, item: dict) -> dict:
    detail_url = item.get("project_url", "")
    if not detail_url:
        return item
    try:
        response = session.get(detail_url, timeout=30)
        response.raise_for_status()
        soup = BeautifulSoup(response.text, "html.parser")
    except Exception as exc:
        print(f"    [!] IsDB detail fetch failed for {detail_url}: {exc}", flush=True)
        return item

    fields = _extract_field_map(soup)
    description = _extract_description(soup)
    document_url = _extract_document_url(soup, detail_url)

    enriched = item.copy()
    enriched["project_start_date"] = _parse_date(fields.get("issue_date", "")) or enriched.get("project_start_date", "")
    enriched["project_end_date"] = _parse_date(fields.get("submission_date", "")) or enriched.get("project_end_date", "")
    enriched["project_description"] = description or enriched.get("project_description", "") or enriched.get("project_name", "")
    enriched["document_url"] = document_url or enriched.get("document_url", "")
    enriched["project_sponsor"] = fields.get("country", "") or enriched.get("project_sponsor", "")
    return enriched


def run_isdb_scraper():
    print("\n" + "=" * 60, flush=True)
    print("  IsDB Tenders Scraper", flush=True)
    print("=" * 60, flush=True)

    session = _build_session()
    all_items: list[dict] = []
    seen_nids: set[str] = set()
    first_html = _fetch_listing_page(session, 0)
    total_pages = _extract_total_pages(first_html)

    print(f"[i] IsDB total listing pages: {total_pages}", flush=True)

    for page in range(total_pages):
        print(f"[>] IsDB listing page {page + 1}", flush=True)
        html = first_html if page == 0 else _fetch_listing_page(session, page)
        page_items = _parse_listing_page(html)
        if not page_items:
            print(f"    [i] Page {page + 1} returned no active tender rows", flush=True)
            continue

        new_items = []
        for item in page_items:
            nid = item.get("nid") or item.get("project_url")
            if nid in seen_nids:
                continue
            seen_nids.add(nid)
            new_items.append(item)

        if not new_items:
            continue

        all_items.extend(new_items)
        print(f"    Found {len(new_items)} active tenders (running total: {len(all_items)})", flush=True)

    if not all_items:
        print("[i] No active IsDB tenders found", flush=True)
        return []

    print(f"[>] Fetching IsDB detail pages for {len(all_items)} tenders", flush=True)
    enriched: list[dict] = []
    with ThreadPoolExecutor(max_workers=DETAIL_WORKERS) as pool:
        futures = {pool.submit(_fetch_detail, _build_session(), item): item for item in all_items}
        for future in as_completed(futures):
            item = futures[future]
            try:
                enriched.append(future.result())
            except Exception as exc:
                print(f"    [!] IsDB detail enrichment failed for {item.get('project_url')}: {exc}", flush=True)
                enriched.append(item)

    enriched.sort(key=lambda item: (item.get("project_end_date", ""), item.get("project_name", "")), reverse=True)
    print(f"[+] IsDB active tenders returned: {len(enriched)}", flush=True)
    return enriched
