"""
Document scraper — fetches document links from project detail pages
and downloads PDFs, Word docs, and Excel files.

Each site has different detail page formats, so we dispatch to
site-specific handlers based on the project's `source` field.
"""

import os
import re
import time
import hashlib
from pathlib import Path
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

# ── Configuration ────────────────────────────────────────────────────────────

DOWNLOAD_DIR = Path(__file__).resolve().parent.parent / "downloads"
MAX_DOCS_PER_PROJECT = 3
MAX_FILE_SIZE_MB = 20
REQUEST_TIMEOUT = 30

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

# File extensions we're interested in
DOC_EXTENSIONS = {".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx"}


# ── Generic helpers ──────────────────────────────────────────────────────────


def _safe_filename(name: str, max_len: int = 80) -> str:
    """Sanitize a string for use as a filename."""
    name = re.sub(r'[<>:"/\\|?*]', "_", name)
    name = re.sub(r"\s+", "_", name).strip("_")
    return name[:max_len] if name else "document"


def _file_ext(url: str) -> str:
    """Extract file extension from a URL."""
    parsed = urlparse(url)
    path = parsed.path.lower()
    for ext in DOC_EXTENSIONS:
        if path.endswith(ext):
            return ext
    return ""


def download_file(url: str, dest_dir: Path, filename: str = "") -> dict | None:
    """Download a file from a URL. Returns metadata dict or None on failure."""
    try:
        resp = requests.get(url, headers=HEADERS, timeout=REQUEST_TIMEOUT, stream=True)
        resp.raise_for_status()

        # Determine filename
        if not filename:
            # Try Content-Disposition header
            cd = resp.headers.get("Content-Disposition", "")
            if "filename=" in cd:
                filename = cd.split("filename=")[-1].strip('"').strip("'")
            else:
                filename = os.path.basename(urlparse(url).path) or "document"

        filename = _safe_filename(filename)

        # Ensure extension
        ext = _file_ext(url)
        if ext and not filename.lower().endswith(ext):
            filename += ext

        # Check size limit via Content-Length
        content_length = resp.headers.get("Content-Length")
        if content_length and int(content_length) > MAX_FILE_SIZE_MB * 1024 * 1024:
            print(f"      [!] Skipping {filename}: too large ({int(content_length) // 1024 // 1024}MB)")
            return None

        dest_dir.mkdir(parents=True, exist_ok=True)
        filepath = dest_dir / filename

        # Avoid duplicate downloads
        if filepath.exists():
            return {
                "filename": filename,
                "path": str(filepath),
                "url": url,
                "size": filepath.stat().st_size,
            }

        total = 0
        with open(filepath, "wb") as f:
            for chunk in resp.iter_content(chunk_size=8192):
                total += len(chunk)
                if total > MAX_FILE_SIZE_MB * 1024 * 1024:
                    f.close()
                    filepath.unlink(missing_ok=True)
                    print(f"      [!] Aborted {filename}: exceeded {MAX_FILE_SIZE_MB}MB limit")
                    return None
                f.write(chunk)

        return {
            "filename": filename,
            "path": str(filepath),
            "url": url,
            "size": total,
        }

    except Exception as e:
        print(f"      [!] Download failed ({url[:80]}): {e}")
        return None


def _find_doc_links(soup: BeautifulSoup, base_url: str) -> list[dict]:
    """Find all document links on a page."""
    links = []
    seen_urls = set()

    for a in soup.find_all("a", href=True):
        href = a["href"]
        full_url = urljoin(base_url, href)
        ext = _file_ext(full_url)

        if not ext:
            # Check link text for document indicators
            text = a.get_text(strip=True).lower()
            if any(kw in text for kw in ["download", "document", "attachment", "pdf", "terms of reference", "tor"]):
                # Could be a document link even without extension
                if any(x in href.lower() for x in ["download", "document", "attachment", "file", "getfile"]):
                    ext = ".pdf"  # assume PDF as default

        if ext and full_url not in seen_urls:
            seen_urls.add(full_url)
            title = a.get_text(strip=True) or os.path.basename(urlparse(full_url).path)
            links.append({
                "url": full_url,
                "title": title[:200],
                "extension": ext,
            })

    return links[:MAX_DOCS_PER_PROJECT]


# ── Site-specific scrapers ───────────────────────────────────────────────────


def _scrape_wb_docs(project: dict, session: requests.Session) -> list[dict]:
    """World Bank: fetch document links from the project API."""
    project_id = project.get("project_id", "")
    if not project_id:
        return []

    # WB Documents API
    api_url = f"https://search.worldbank.org/api/v2/wds?format=json&projectid={project_id}&fl=docdt,docty,display_title,pdfurl&rows=10"
    try:
        resp = session.get(api_url, headers=HEADERS, timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()
        data = resp.json()

        docs = []
        for doc_id, doc in data.get("documents", {}).items():
            if doc_id == "facets":
                continue
            pdf_url = doc.get("pdfurl", "")
            title = doc.get("display_title", "")
            if pdf_url:
                docs.append({
                    "url": pdf_url,
                    "title": title[:200],
                    "extension": ".pdf",
                })
            if len(docs) >= MAX_DOCS_PER_PROJECT:
                break
        return docs
    except Exception as e:
        print(f"      [!] WB docs API failed: {e}")
        return []


def _scrape_gt_docs(project: dict, session: requests.Session) -> list[dict]:
    """Global Tenders: scrape detail page for document links."""
    url = project.get("project_url", "")
    if not url:
        return []

    try:
        resp = session.get(url, headers=HEADERS, timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")
        return _find_doc_links(soup, url)
    except Exception as e:
        print(f"      [!] GT detail page failed: {e}")
        return []


def _scrape_dg_docs(project: dict, session: requests.Session) -> list[dict]:
    """DGMarket: scrape detail page for attached documents."""
    url = project.get("project_url", "")
    if not url:
        return []

    try:
        resp = session.get(url, headers=HEADERS, timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")
        return _find_doc_links(soup, url)
    except Exception as e:
        print(f"      [!] DGMarket detail page failed: {e}")
        return []


def _scrape_giz_docs(project: dict, session: requests.Session) -> list[dict]:
    """GIZ: scrape detail page (forwarding URL) for documents."""
    url = project.get("project_url", "")
    if not url:
        return []

    try:
        resp = session.get(
            url, headers=HEADERS, timeout=REQUEST_TIMEOUT,
            cookies={"locale": "ENGLISH"},
        )
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")
        return _find_doc_links(soup, url)
    except Exception as e:
        print(f"      [!] GIZ detail page failed: {e}")
        return []


def _scrape_devaid_docs(project: dict, session: requests.Session) -> list[dict]:
    """DevelopmentAid: fetch the tender detail API for document links."""
    tender_id = project.get("project_id", "")
    if not tender_id:
        return []

    api_url = f"https://www.developmentaid.org/api/frontend/tender/{tender_id}"
    try:
        resp = session.get(api_url, headers={
            **HEADERS,
            "Accept": "application/json, text/plain, */*",
            "Origin": "https://www.developmentaid.org",
            "Referer": "https://www.developmentaid.org/tenders/search",
        }, timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()
        data = resp.json()

        docs = []
        for doc in data.get("documents", []):
            doc_url = doc.get("url", "")
            title = doc.get("name", "") or doc.get("title", "")
            if doc_url:
                ext = _file_ext(doc_url) or ".pdf"
                docs.append({
                    "url": doc_url,
                    "title": title[:200],
                    "extension": ext,
                })
            if len(docs) >= MAX_DOCS_PER_PROJECT:
                break

        # Also check the detail page HTML for more links
        if len(docs) < MAX_DOCS_PER_PROJECT:
            project_url = project.get("project_url", "")
            if project_url:
                try:
                    resp2 = session.get(project_url, headers=HEADERS, timeout=REQUEST_TIMEOUT)
                    resp2.raise_for_status()
                    soup = BeautifulSoup(resp2.text, "html.parser")
                    page_docs = _find_doc_links(soup, project_url)
                    for pd in page_docs:
                        if pd["url"] not in {d["url"] for d in docs}:
                            docs.append(pd)
                        if len(docs) >= MAX_DOCS_PER_PROJECT:
                            break
                except Exception:
                    pass

        return docs
    except Exception as e:
        print(f"      [!] DevAid detail API failed: {e}")
        return []


def _scrape_iadb_docs(project: dict, session: requests.Session) -> list[dict]:
    """IADB: try to find docs from project URL."""
    url = project.get("project_url", "")
    if not url:
        return []

    try:
        resp = session.get(url, headers=HEADERS, timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")
        return _find_doc_links(soup, url)
    except Exception as e:
        print(f"      [!] IADB detail page failed: {e}")
        return []


# ── Dispatcher ───────────────────────────────────────────────────────────────

_SCRAPERS = {
    "World Bank": _scrape_wb_docs,
    "Global Tenders": _scrape_gt_docs,
    "DGMarket": _scrape_dg_docs,
    "GIZ": _scrape_giz_docs,
    "DevelopmentAid": _scrape_devaid_docs,
    "IADB": _scrape_iadb_docs,
}


def scrape_and_download_docs(project: dict, session: requests.Session = None) -> list[dict]:
    """
    Scrape document links from a project's detail page and download them.

    Returns a list of document metadata dicts with keys:
        filename, path, url, size, title, extension
    """
    if session is None:
        session = requests.Session()

    source = project.get("source", "")
    scraper = _SCRAPERS.get(source)
    if not scraper:
        return []

    # Find document links
    doc_links = scraper(project, session)
    if not doc_links:
        return []

    # Download each document
    project_id = project.get("project_id", "") or hashlib.md5(
        project.get("project_name", "").encode()
    ).hexdigest()[:12]
    dest_dir = DOWNLOAD_DIR / _safe_filename(str(project_id))

    downloaded = []
    for doc_link in doc_links:
        print(f"      📥 Downloading: {doc_link['title'][:60]}...")
        result = download_file(doc_link["url"], dest_dir, doc_link.get("title", ""))
        if result:
            result["title"] = doc_link.get("title", "")
            result["extension"] = doc_link.get("extension", "")
            downloaded.append(result)

        # Small delay between downloads
        time.sleep(0.5)

    return downloaded
