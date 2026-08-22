"""
Niger Marchés tender aggregator scraper.

Scrapes the first page of https://www.nigermarches.com/appel-doffre/.
Each listing card is a WordPress custom-post-type item rendered by Elementor;
we parse the rendered HTML rather than relying on semantic class names.

The scraper:
1. Fetches the first listing page.
2. Extracts every <article class="... appel_d_offre ..."> card.
3. Pulls title, detail URL, organisation, location, publication date,
   deadline and status from the card's icon-list widgets.
4. Optionally follows each detail page to get a real description.
"""

from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from urllib.parse import urljoin
import re

import requests
from bs4 import BeautifulSoup

from shared_excel import format_date


BASE_URL = "https://www.nigermarches.com/appel-doffre/"
SITE_BASE_URL = "https://www.nigermarches.com"
DETAIL_WORKERS = 4
DETAIL_TIMEOUT = 20

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7",
}


def _normalize_whitespace(text: str) -> str:
    return " ".join((text or "").split())


def _parse_card_date(text: str) -> str:
    """Parse dates like '17/08/2026 à 00:05' to MM/DD/YYYY."""
    text = (text or "").strip()
    if not text:
        return ""
    try:
        dt = datetime.strptime(text, "%d/%m/%Y à %H:%M")
        return dt.strftime("%m/%d/%Y")
    except ValueError:
        pass
    return format_date(text)


def _extract_post_id(article: BeautifulSoup) -> str:
    """WordPress post ID from the article's id attribute, e.g. post-20927."""
    post_id = (article.get("id") or "").replace("post-", "").strip()
    if post_id:
        return post_id
    # Fallback: derive a stable id from the first CSS class that looks like post-NNNN
    for cls in article.get("class") or []:
        if cls.startswith("post-"):
            return cls.replace("post-", "")
    return ""


def _parse_list_item(article: BeautifulSoup) -> dict | None:
    """Parse one <article> card into a project dict.

    The Elementor cards expose six icon-list items but their order changes
    depending on whether the tender is active or expired. We classify by
    content rather than by index.
    """
    title_link = article.select_one("h3.elementor-heading-title a")
    if not title_link:
        return None

    title = _normalize_whitespace(title_link.get_text())
    detail_url = title_link.get("href", "")
    if detail_url and not detail_url.startswith("http"):
        detail_url = urljoin(SITE_BASE_URL, detail_url)

    meta_spans = article.select("span.elementor-icon-list-text")
    meta_texts = [_normalize_whitespace(s.get_text()) for s in meta_spans]

    # First two are usually organisation and location.  If there are fewer than
    # two items, leave the missing ones empty.
    organisation = meta_texts[0] if len(meta_texts) > 0 else ""
    location = meta_texts[1] if len(meta_texts) > 1 else ""

    # Find date-looking entries (dd/mm/yyyy à hh:mm). First is publication,
    # second is deadline.
    date_texts = [
        t for t in meta_texts
        if re.search(r"\d{2}/\d{2}/\d{4}\s+à\s+\d{2}:\d{2}", t)
    ]
    pub_date = _parse_card_date(date_texts[0]) if len(date_texts) > 0 else ""
    deadline = _parse_card_date(date_texts[1]) if len(date_texts) > 1 else ""

    # Status and remaining can be swapped. Identify them by content.
    status = ""
    remaining = ""
    for text in meta_texts:
        lowered = text.lower()
        if "en cours" in lowered or "expir" in lowered:
            status = text
        elif "temps restant" in lowered:
            remaining = text

    # Skip expired tenders so the downstream pipeline doesn't need to filter
    # them out later.
    if "expir" in (status or "").lower():
        return None

    project_id = _extract_post_id(article)
    if not project_id:
        project_id = detail_url.rstrip("/").split("/")[-1] if detail_url else ""

    if not title or not project_id:
        return None

    return {
        "project_id": project_id,
        "project_name": title,
        "project_start_date": pub_date,
        "project_end_date": deadline,
        "project_description": title,
        "project_sponsor": organisation,
        "source": "Niger Marchés",
        "document_url": "",
        "project_url": detail_url,
        "matched_keywords": "",
        # Extra metadata kept for transparency; downstream code ignores unknown keys.
        "_niger_status": status,
        "_niger_location": location,
        "_niger_remaining": remaining,
    }


def _fetch_detail_description(session: requests.Session, url: str) -> str:
    """Fetch the detail page and return its main text content."""
    if not url:
        return ""
    try:
        resp = session.get(url, headers=HEADERS, timeout=DETAIL_TIMEOUT)
        resp.raise_for_status()
    except requests.RequestException as exc:
        print(f"    [!] Niger Marchés detail request failed: {exc}")
        return ""

    try:
        soup = BeautifulSoup(resp.text, "html.parser")
        container = (
            soup.select_one("main#main")
            or soup.find("article")
            or soup.body
        )
        if not container:
            return ""
        return _normalize_whitespace(container.get_text(" ", strip=True))
    except Exception as exc:
        print(f"    [!] Niger Marchés detail parse failed: {exc}")
        return ""


def _enrich_descriptions(session: requests.Session, projects: list[dict]) -> None:
    """Populate project_description from detail pages where useful."""
    eligible = [
        (idx, p)
        for idx, p in enumerate(projects)
        if p.get("project_url")
    ]
    if not eligible:
        return

    def worker(project: dict) -> str:
        # Use a fresh session clone per worker to avoid cookie/cross-talk issues.
        worker_session = requests.Session()
        worker_session.headers.update(session.headers)
        worker_session.cookies.update(session.cookies)
        return _fetch_detail_description(worker_session, project["project_url"])

    print(f"    Fetching {len(eligible)} detail pages for descriptions...")
    with ThreadPoolExecutor(max_workers=DETAIL_WORKERS) as executor:
        future_to_idx = {
            executor.submit(worker, p): idx for idx, p in eligible
        }
        for future in as_completed(future_to_idx):
            idx = future_to_idx[future]
            description = future.result()
            if description:
                projects[idx]["project_description"] = description


def fetch_first_page(session: requests.Session) -> list[dict]:
    """Fetch and parse the first page of Niger Marchés listings."""
    try:
        resp = session.get(BASE_URL, headers=HEADERS, timeout=30)
        resp.raise_for_status()
    except requests.RequestException as exc:
        print(f"    [!] Niger Marchés listing request failed: {exc}")
        return []

    soup = BeautifulSoup(resp.text, "html.parser")
    articles = soup.find_all("article", class_=lambda c: c and "appel_d_offre" in c)

    projects = []
    for article in articles:
        try:
            project = _parse_list_item(article)
            if project:
                projects.append(project)
        except Exception as exc:
            print(f"    [!] Niger Marchés item parse error: {exc}")

    return projects


def run_nigermarches_scraper() -> list[dict]:
    """Entry point: scrape first page, enrich descriptions, return project dicts."""
    print("\n" + "=" * 60)
    print("  Niger Marchés Scraper")
    print("  First page only:", BASE_URL)
    print("=" * 60)

    session = requests.Session()
    session.headers.update(HEADERS)

    projects = fetch_first_page(session)
    print(f"    Found {len(projects)} tenders on first page")

    if projects:
        _enrich_descriptions(session, projects)

    print(f"[+] Niger Marchés: {len(projects)} unique tenders")
    return projects


if __name__ == "__main__":
    import json

    results = run_nigermarches_scraper()
    print(f"\n[+] Final: {len(results)} projects")
    for p in results[:5]:
        print(f"  - [{p['project_id']}] {p['project_name'][:80]} ({p['project_sponsor']})")

    with open("nigermarches_projects.json", "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)
    print("[+] Saved to nigermarches_projects.json")
