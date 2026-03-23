"""
African Union bids scraper.

Fetches the public AU bids feed through the Drupal Views AJAX endpoint,
walks all pages, enriches each bid from its detail page, and returns
normalized projects for the shared AI verification pipeline.
"""

from __future__ import annotations

import json
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup


BASE_URL = "https://au.int"
BIDS_URL = f"{BASE_URL}/en/bids"
AJAX_URL_FALLBACK = f"{BASE_URL}/en/views/ajax"
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/javascript, */*; q=0.01",
    "Accept-Language": "en-US,en;q=0.9",
    "Origin": BASE_URL,
    "Referer": BIDS_URL,
    "X-Requested-With": "XMLHttpRequest",
}
DETAIL_WORKERS = 5
MAX_PAGES = 40


def _normalize_space(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "")).strip()


def _build_session() -> requests.Session:
    session = requests.Session()
    session.headers.update(HEADERS)
    return session


def _parse_date(value: str) -> str:
    text = _normalize_space(value)
    if not text:
        return ""
    for fmt in ("%B %d, %Y", "%b %d, %Y", "%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(text, fmt).strftime("%m/%d/%Y")
        except ValueError:
            continue
    return ""


def _date_is_actionable(mmddyyyy: str) -> bool:
    if not mmddyyyy:
        return False
    try:
        deadline = datetime.strptime(mmddyyyy, "%m/%d/%Y").date()
        return deadline >= date.today()
    except ValueError:
        return False


def _fetch_text(session: requests.Session, url: str) -> str:
    for attempt in range(3):
        try:
            response = session.get(url, timeout=30)
            response.raise_for_status()
            return response.text
        except Exception as exc:
            if attempt == 2:
                print(f"    [!] African Union request failed for {url}: {exc}", flush=True)
                return ""
            time.sleep(1.3 * (attempt + 1))
    return ""


def _extract_config_value(pattern: str, html: str) -> str:
    match = re.search(pattern, html)
    if not match:
        return ""
    return match.group(1).replace("\\/", "/")


def _extract_views_config(html: str) -> dict[str, str]:
    dom_id = _extract_config_value(r'"views_dom_id:([^"]+)":\{', html)
    if not dom_id:
        dom_id = _extract_config_value(r'"view_dom_id":"([^"]+)"', html)

    return {
        "ajax_path": _extract_config_value(r'"ajax_path":"([^"]+)"', html) or "/en/views/ajax",
        "theme": _extract_config_value(r'"theme":"([^"]+)"', html) or "au",
        "theme_token": _extract_config_value(r'"theme_token":"([^"]+)"', html),
        "jquery_version": _extract_config_value(r'"jquery_version":"([^"]+)"', html) or "1.10",
        "view_name": _extract_config_value(r'"view_name":"([^"]+)"', html) or "bids",
        "view_display_id": _extract_config_value(r'"view_display_id":"([^"]+)"', html) or "page_1",
        "view_args": _extract_config_value(r'"view_args":"([^"]+)"', html),
        "view_path": _extract_config_value(r'"view_path":"([^"]+)"', html) or "node/38137",
        "view_base_path": _extract_config_value(r'"view_base_path":"([^"]+)"', html) or "bids2",
        "view_dom_id": dom_id,
        "pager_element": _extract_config_value(r'"pager_element":(\d+)', html) or "0",
    }


def _build_ajax_payload(config: dict[str, str], page_index: int) -> dict[str, str]:
    payload = {
        "field_tags_documents_tid_i18n": "All",
        "view_name": config["view_name"],
        "view_display_id": config["view_display_id"],
        "view_args": config["view_args"],
        "view_path": config["view_path"],
        "view_base_path": config["view_base_path"],
        "view_dom_id": config["view_dom_id"],
        "pager_element": config["pager_element"],
        "page": str(page_index),
        "ajax_page_state[theme]": config["theme"],
        "ajax_page_state[theme_token]": config["theme_token"],
        "ajax_page_state[jquery_version]": config["jquery_version"],
    }
    return payload


def _extract_insert_html(commands: list[dict], view_dom_id: str) -> str:
    target_selector = f".view-dom-id-{view_dom_id}" if view_dom_id else ""
    for command in commands:
        if command.get("command") != "insert":
            continue
        selector = command.get("selector", "")
        data = command.get("data", "")
        if target_selector and selector == target_selector and "views-table" in data:
            return data
        if "view-id-bids" in data and "views-table" in data:
            return data
    return ""


def _extract_document_url(soup: BeautifulSoup, detail_url: str) -> str:
    for link in soup.select("a[href]"):
        href = link.get("href", "").strip()
        if not href:
            continue
        lowered = href.lower()
        text = _normalize_space(link.get_text(" ", strip=True)).lower()
        if any(token in lowered for token in (".pdf", ".doc", ".docx", ".zip")) or "bid document" in text:
            return urljoin(detail_url, href)
    return ""


def _extract_bid_number(text: str) -> str:
    match = re.search(r"Bid\s*#\s*([A-Z0-9\-./]+)", text, re.IGNORECASE)
    return _normalize_space(match.group(1)) if match else ""


def _extract_detail_description(soup: BeautifulSoup) -> str:
    selectors = [
        ".region-content .node",
        "#main-content .node",
        "article.node",
        ".field-name-body",
    ]
    for selector in selectors:
        node = soup.select_one(selector)
        if not node:
            continue
        texts = []
        for p in node.select("p"):
            text = _normalize_space(p.get_text(" ", strip=True))
            if len(text) >= 40:
                texts.append(text)
        if texts:
            return "\n\n".join(texts[:8])

    body_text = _normalize_space(soup.get_text(" ", strip=True))
    return body_text[:1200] if body_text else ""


def _detail_looks_open(soup: BeautifulSoup) -> bool:
    text = _normalize_space(soup.get_text(" ", strip=True)).lower()
    if "closed" in text or "expired" in text:
        return False
    return any(token in text for token in ("bid document", "deadline", "march", "april", "open"))


def _fetch_detail(item: dict) -> dict | None:
    detail_url = item.get("project_url", "")
    if not detail_url:
        return item if _date_is_actionable(item.get("project_end_date", "")) else None

    session = _build_session()
    html = _fetch_text(session, detail_url)
    if not html:
        return item if _date_is_actionable(item.get("project_end_date", "")) else None

    soup = BeautifulSoup(html, "html.parser")
    page_text = _normalize_space(soup.get_text(" ", strip=True))

    enriched = item.copy()
    title_node = soup.select_one("h1, #page-title")
    if title_node:
        title = _normalize_space(title_node.get_text(" ", strip=True))
        if title:
            enriched["project_name"] = title

    range_match = re.search(r"([A-Za-z]+ \d{1,2}, \d{4})\s+to\s+([A-Za-z]+ \d{1,2}, \d{4})", page_text)
    if range_match:
        start_date = _parse_date(range_match.group(1))
        end_date = _parse_date(range_match.group(2))
        if start_date:
            enriched["project_start_date"] = start_date
        if end_date:
            enriched["project_end_date"] = end_date

    bid_number = _extract_bid_number(page_text)
    if bid_number:
        enriched["bid_number"] = bid_number
        enriched["project_id"] = f"AFRICANUNION-{bid_number}"

    description = _extract_detail_description(soup)
    if description:
        enriched["project_description"] = description

    document_url = _extract_document_url(soup, detail_url)
    if document_url:
        enriched["document_url"] = document_url

    if _date_is_actionable(enriched.get("project_end_date", "")):
        return enriched
    if not enriched.get("project_end_date") and _detail_looks_open(soup):
        return enriched
    return None


def _row_to_project(row, base_url: str) -> dict | None:
    cells = row.find_all("td")
    if len(cells) < 4:
        return None

    deadline_text = _normalize_space(cells[0].get_text(" ", strip=True))
    title_link = cells[1].find("a", href=True)
    bid_type = _normalize_space(cells[2].get_text(" ", strip=True))
    bid_number = _normalize_space(cells[3].get_text(" ", strip=True))

    if not title_link:
        return None

    title = _normalize_space(title_link.get_text(" ", strip=True))
    detail_url = urljoin(base_url, title_link.get("href", "").strip())
    deadline = _parse_date(deadline_text)
    path_slug = urlparse(detail_url).path.rstrip("/").split("/")[-1]
    stable_id = bid_number or path_slug or title

    return {
        "project_id": f"AFRICANUNION-{stable_id}",
        "project_name": title,
        "project_start_date": "",
        "project_end_date": deadline,
        "project_description": title,
        "project_sponsor": "African Union",
        "source": "African Union",
        "document_url": "",
        "project_url": detail_url,
        "bid_type": bid_type,
        "bid_number": bid_number,
        "ai_verified": "",
        "decision": "",
    }


def _parse_listing_fragment(html: str) -> list[dict]:
    if not html:
        return []
    soup = BeautifulSoup(html, "html.parser")
    table = soup.select_one("table.views-table")
    if not table:
        return []
    projects = []
    for row in table.select("tbody tr"):
        project = _row_to_project(row, BASE_URL)
        if project:
            projects.append(project)
    return projects


def _fetch_ajax_page(session: requests.Session, config: dict[str, str], page_index: int) -> str:
    ajax_url = urljoin(BASE_URL, config.get("ajax_path") or AJAX_URL_FALLBACK)
    payload = _build_ajax_payload(config, page_index)
    headers = {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    }
    for attempt in range(3):
        try:
            response = session.post(ajax_url, data=payload, headers=headers, timeout=30)
            response.raise_for_status()
            commands = response.json()
            return _extract_insert_html(commands, config.get("view_dom_id", ""))
        except Exception as exc:
            if attempt == 2:
                print(f"    [!] African Union AJAX page {page_index} failed: {exc}", flush=True)
                return ""
            time.sleep(1.2 * (attempt + 1))
    return ""


def _collect_listing_projects(session: requests.Session, config: dict[str, str]) -> list[dict]:
    all_projects: list[dict] = []
    seen_urls: set[str] = set()

    for page_index in range(MAX_PAGES):
        fragment_html = _fetch_ajax_page(session, config, page_index)
        page_projects = _parse_listing_fragment(fragment_html)
        if not page_projects:
            break

        new_count = 0
        for project in page_projects:
            url = project.get("project_url", "")
            if url in seen_urls:
                continue
            seen_urls.add(url)
            all_projects.append(project)
            new_count += 1

        if new_count == 0:
            break
        time.sleep(0.35)

    return all_projects


def run_africanunion_scraper() -> list[dict]:
    print("\n" + "=" * 60, flush=True)
    print("  African Union Bids Scraper", flush=True)
    print("=" * 60, flush=True)

    session = _build_session()
    html = _fetch_text(session, BIDS_URL)
    if not html:
        return []

    config = _extract_views_config(html)
    listing_projects = _collect_listing_projects(session, config)
    print(f"[+] African Union listing rows found: {len(listing_projects)}", flush=True)
    if not listing_projects:
        return []

    enriched_projects: list[dict] = []
    with ThreadPoolExecutor(max_workers=min(DETAIL_WORKERS, len(listing_projects))) as executor:
        futures = {executor.submit(_fetch_detail, project): project for project in listing_projects}
        for future in as_completed(futures):
            try:
                result = future.result()
            except Exception as exc:
                fallback = futures[future]
                print(f"    [!] African Union detail fetch failed for {fallback.get('project_url', '')}: {exc}", flush=True)
                result = fallback if _date_is_actionable(fallback.get("project_end_date", "")) else None
            if result:
                enriched_projects.append(result)

    deduped: dict[tuple[str, str], dict] = {}
    for project in enriched_projects:
        dedup_key = (
            project.get("bid_number") or project.get("project_url") or project.get("project_id", ""),
            project.get("project_name", ""),
        )
        deduped[dedup_key] = project

    all_projects = list(deduped.values())
    print(f"[+] African Union actionable notices after enrichment: {len(all_projects)}", flush=True)
    return all_projects
