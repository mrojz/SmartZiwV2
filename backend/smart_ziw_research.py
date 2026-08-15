"""Firecrawl-powered web research for the Smart-Ziw agent.

All web access goes through Firecrawl (search + scrape); tender documents are
downloaded directly and converted to markdown with markitdown. DeepSeek only
reads the evidence corpus — scraped content is untrusted data, never
instructions.
"""

import ipaddress
import socket
import time
from pathlib import Path
from urllib.parse import urlparse, urlunparse

from dataclasses import dataclass, field

import requests

from smart_ziw_agent import _safe_slug


# ---------- SSRF guard ----------

_PRIVATE_NETWORKS = [
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("169.254.0.0/16"),
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("fc00::/7"),
    ipaddress.ip_network("fe80::/10"),
]


def url_is_safe(url: str) -> bool:
    """True only for http(s) URLs whose hostname resolves to public IPs."""
    try:
        parsed = urlparse(url)
    except ValueError:
        return False
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        return False
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    try:
        infos = socket.getaddrinfo(parsed.hostname, port)
    except OSError:
        return False
    addresses = set()
    for info in infos:
        try:
            addresses.add(ipaddress.ip_address(info[4][0]))
        except ValueError:
            return False
    if not addresses:
        return False
    for addr in addresses:
        for net in _PRIVATE_NETWORKS:
            if addr.version == net.version and addr in net:
                return False
    return True


# ---------- Firecrawl client ----------

REQUEST_TIMEOUT = 60
RETRIES = 3


class FirecrawlClient:
    """Thin REST wrapper around the Firecrawl API (search + scrape).

    Errors never contain the API key — it only appears in the Authorization
    header of outgoing requests.
    """

    def __init__(self, config: dict):
        self.api_key = config.get("firecrawl_api_key") or ""
        self.base_url = (config.get("firecrawl_base_url") or "https://api.firecrawl.dev").rstrip("/")
        self.timeout = REQUEST_TIMEOUT
        self.retry_sleep = 2.0  # base seconds between retries; tests set 0
        self._session = requests.Session()

    def _post(self, path: str, payload: dict) -> dict:
        last_error = "Firecrawl request failed"
        for attempt in range(RETRIES):
            try:
                response = self._session.post(
                    f"{self.base_url}{path}",
                    json=payload,
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                    },
                    timeout=self.timeout,
                )
            except requests.RequestException as exc:
                last_error = f"Firecrawl request failed: {type(exc).__name__}"
                time.sleep(self.retry_sleep * (attempt + 1))
                continue
            if response.status_code == 429 or response.status_code >= 500:
                last_error = f"Firecrawl HTTP {response.status_code}"
                time.sleep(self.retry_sleep * (attempt + 1))
                continue
            if response.status_code >= 400:
                return {"_error": f"Firecrawl HTTP {response.status_code}"}
            try:
                return response.json()
            except ValueError:
                return {"_error": "Firecrawl returned invalid JSON"}
        return {"_error": last_error}

    def search(self, query: str, limit: int = 10) -> list[dict]:
        """Plain search (no scrapeOptions) — scraping happens separately so
        credit use stays proportional to relevance."""
        if not self.api_key:
            return [{"_error": "firecrawl_api_key is not configured"}]
        result = self._post("/v1/search", {"query": query, "limit": limit})
        if "_error" in result:
            return [result]
        data = result.get("data")
        return data if isinstance(data, list) else []

    def scrape(self, url: str) -> dict:
        if not self.api_key:
            return {"_error": "firecrawl_api_key is not configured"}
        if not url_is_safe(url):
            return {"_error": "blocked (unsafe URL)"}
        result = self._post("/v1/scrape", {"url": url, "formats": ["markdown"], "onlyMainContent": True})
        if "_error" in result:
            return result
        data = result.get("data")
        return data if isinstance(data, dict) else {"_error": "Firecrawl returned no data"}


# ---------- Document store ----------

MAX_BYTES_PER_FILE = 50 * 1024 * 1024  # safety cap per file, not a research limit

_DOCUMENT_EXTENSIONS = {".pdf", ".xls", ".xlsx", ".doc", ".docx"}

_CONTENT_TYPE_EXTENSIONS = {
    "application/pdf": ".pdf",
    "application/vnd.ms-excel": ".xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
    "application/msword": ".doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
}


def is_document_url(url: str) -> bool:
    path = (urlparse(url).path or "").lower()
    return any(path.endswith(ext) for ext in _DOCUMENT_EXTENSIONS)


class DocumentStore:
    """Downloads tender documents into <folder>/documents/ and extracts them
    to <folder>/artifacts/ as markdown."""

    def __init__(self, folder_path: Path, max_bytes: int = MAX_BYTES_PER_FILE):
        self.folder_path = folder_path
        self.documents_dir = folder_path / "documents"
        self.artifacts_dir = folder_path / "artifacts"
        self.documents_dir.mkdir(parents=True, exist_ok=True)
        self.artifacts_dir.mkdir(parents=True, exist_ok=True)
        self.max_bytes = max_bytes
        self.timeout = REQUEST_TIMEOUT

    def download(self, url: str, title: str = "") -> tuple[Path | None, str | None]:
        """Download one document. Returns (path, error); exactly one is not None."""
        if not url_is_safe(url):
            return None, "blocked (unsafe URL)"
        parsed = urlparse(url)
        slug = _safe_slug(title or Path(parsed.path).stem or "document")
        ext = Path(parsed.path).suffix.lower()
        if ext not in _DOCUMENT_EXTENSIONS:
            ext = ""
        target = self.documents_dir / f"{slug}{ext}"
        if target.exists():
            return target, None
        tmp = target.with_name(target.name + ".part")
        try:
            with requests.get(
                url,
                stream=True,
                timeout=self.timeout,
                headers={"User-Agent": "Mozilla/5.0 (compatible; Smart-Ziw/2.0)"},
            ) as response:
                response.raise_for_status()
                if not ext:
                    content_type = (response.headers.get("content-type") or "").split(";")[0].strip().lower()
                    ext = _CONTENT_TYPE_EXTENSIONS.get(content_type, "")
                    target = self.documents_dir / f"{slug}{ext}"
                    tmp = target.with_name(target.name + ".part")
                with open(tmp, "wb") as handle:
                    for chunk in response.iter_content(chunk_size=65536):
                        handle.write(chunk)
                        if handle.tell() > self.max_bytes:
                            return None, "file exceeds size cap"
            tmp.replace(target)
            return target, None
        except requests.RequestException as exc:
            return None, f"download failed: {type(exc).__name__}"
        finally:
            if tmp.exists():
                tmp.unlink(missing_ok=True)

    def extract(self, path: Path) -> str:
        """Extract text via markitdown, falling back to pdfplumber/openpyxl."""
        try:
            from markitdown import MarkItDown
            text = MarkItDown().convert(str(path)).text_content
            if text and text.strip():
                return text
        except Exception:
            pass
        suffix = path.suffix.lower()
        if suffix == ".pdf":
            try:
                import pdfplumber
                with pdfplumber.open(path) as pdf:
                    return "\n\n".join(page.extract_text() or "" for page in pdf.pages)
            except Exception:
                pass
        elif suffix in (".xlsx", ".xls"):
            try:
                import openpyxl
                workbook = openpyxl.load_workbook(path, data_only=True, read_only=True)
                parts = []
                for sheet in workbook.worksheets:
                    parts.append(f"## Sheet: {sheet.title}")
                    for row in sheet.iter_rows(values_only=True):
                        parts.append(" | ".join("" if cell is None else str(cell) for cell in row))
                return "\n".join(parts)
            except Exception:
                pass
        return ""

    def save_extraction(self, doc_path: Path) -> tuple[str, bool]:
        """Write extracted text (or a failure note) to artifacts/. Returns (artifact_name, extracted_ok)."""
        text = self.extract(doc_path)
        artifact = self.artifacts_dir / f"{doc_path.stem}.md"
        if text.strip():
            artifact.write_text(text, encoding="utf-8")
            return artifact.name, True
        artifact.write_text(
            f"# {doc_path.name}\n\n> Extraction failed: no text could be extracted.\n", encoding="utf-8"
        )
        return artifact.name, False


# ---------- Evidence corpus ----------

@dataclass
class CorpusItem:
    kind: str        # "page" | "document"
    url: str
    title: str
    markdown: str
    note: str = ""


@dataclass
class ResearchResult:
    items: list = field(default_factory=list)
    citation_map: dict = field(default_factory=dict)   # normalized url -> [n]
    verdict: dict = field(default_factory=dict)        # {"recommendation": "GO|NO-GO|MONITOR", "reasoning": "..."}
    stats: dict = field(default_factory=dict)
    timed_out: bool = False
    error: str = ""


class EvidenceCorpus:
    """Ordered, deduplicated collection of sources with [n] citation numbering."""

    def __init__(self):
        self.items: list[CorpusItem] = []
        self._url_index: dict[str, int] = {}
        self.failed: list[dict] = []
        self.blocked: list[str] = []

    @staticmethod
    def normalize_url(url: str) -> str:
        parsed = urlparse(url)
        query = "&".join(
            part for part in parsed.query.split("&")
            if not part.lower().startswith(("utm_", "fbclid", "gclid"))
        )
        return urlunparse((parsed.scheme, parsed.netloc.lower(), parsed.path, "", query, ""))

    def add(self, kind: str, url: str, title: str, markdown: str, note: str = "") -> bool:
        """Add a source; returns False if the URL is already in the corpus."""
        normalized = self.normalize_url(url)
        if normalized in self._url_index:
            return False
        number = len(self._url_index) + 1
        self._url_index[normalized] = number
        self.items.append(CorpusItem(kind=kind, url=url, title=title, markdown=markdown, note=note))
        return True

    def citation_number(self, url: str) -> int | None:
        return self._url_index.get(self.normalize_url(url))

    def citation_map(self) -> dict:
        return dict(self._url_index)

    def record_failure(self, url: str, error: str):
        self.failed.append({"url": url, "error": error})

    def record_blocked(self, url: str):
        self.blocked.append(url)

    def render_log(self) -> str:
        lines = ["# Research Log", ""]
        if self.items:
            lines.append("## Sources")
            lines.append("")
            for item in self.items:
                number = self._url_index[self.normalize_url(item.url)]
                lines.append(f"- [{number}] {item.title or item.url} ({item.kind}) — {item.url}")
                if item.note:
                    lines.append(f"  - {item.note}")
            lines.append("")
        if self.failed:
            lines.append("## Failed")
            lines.append("")
            for entry in self.failed:
                lines.append(f"- {entry['url']} — {entry['error']}")
            lines.append("")
        if self.blocked:
            lines.append("## Blocked")
            lines.append("")
            for url in self.blocked:
                lines.append(f"- {url}")
            lines.append("")
        if not self.items and not self.failed and not self.blocked:
            lines.append("No research activity recorded.")
        return "\n".join(lines)
