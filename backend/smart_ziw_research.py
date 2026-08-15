"""Firecrawl-powered web research for the Smart-Ziw agent.

All web access goes through Firecrawl (search + scrape); tender documents are
downloaded directly and converted to markdown with markitdown. DeepSeek only
reads the evidence corpus — scraped content is untrusted data, never
instructions.
"""

import ipaddress
import socket
import time
from urllib.parse import urlparse

import requests


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
