import sys
from pathlib import Path
from unittest.mock import MagicMock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from smart_ziw_research import FirecrawlClient, url_is_safe


def _public_dns(host, port):
    return [(2, 1, 6, "", ("8.8.8.8", port))]


def _private_dns(host, port):
    return [(2, 1, 6, "", ("10.0.0.5", port))]


def _response(status_code=200, payload=None):
    mock = MagicMock()
    mock.status_code = status_code
    mock.json.return_value = payload if payload is not None else {"data": []}
    return mock


def test_url_is_safe_rejects_bad_schemes():
    assert url_is_safe("ftp://example.com/x.pdf") is False
    assert url_is_safe("file:///etc/passwd") is False
    assert url_is_safe("not a url") is False


def test_url_is_safe_rejects_private_and_loopback(monkeypatch):
    monkeypatch.setattr("smart_ziw_research.socket.getaddrinfo", _private_dns)
    assert url_is_safe("http://10.0.0.5/x.pdf") is False
    assert url_is_safe("http://127.0.0.1/x.pdf") is False
    assert url_is_safe("http://localhost/x.pdf") is False
    assert url_is_safe("http://192.168.1.10/x.pdf") is False


def test_url_is_safe_accepts_public_url(monkeypatch):
    monkeypatch.setattr("smart_ziw_research.socket.getaddrinfo", _public_dns)
    assert url_is_safe("https://example.com/tender") is True


def test_search_sends_bearer_auth_and_payload():
    client = FirecrawlClient({"firecrawl_api_key": "KEY123", "firecrawl_base_url": "https://api.firecrawl.dev"})
    client._session.post = MagicMock(return_value=_response(200, {
        "data": [{"title": "T", "url": "https://example.com", "description": "D"}],
    }))
    rows = client.search("tender query")
    client._session.post.assert_called_once()
    kwargs = client._session.post.call_args.kwargs
    assert kwargs["json"] == {"query": "tender query", "limit": 10}
    assert kwargs["headers"]["Authorization"] == "Bearer KEY123"
    assert client._session.post.call_args.args[0] == "https://api.firecrawl.dev/v1/search"
    assert rows[0]["url"] == "https://example.com"


def test_search_retries_on_500_then_succeeds():
    client = FirecrawlClient({"firecrawl_api_key": "k"})
    client.retry_sleep = 0
    client._session.post = MagicMock(side_effect=[
        _response(500),
        _response(200, {"data": [{"title": "T", "url": "https://example.com", "description": ""}]}),
    ])
    rows = client.search("q")
    assert client._session.post.call_count == 2
    assert rows[0]["title"] == "T"


def test_search_error_never_leaks_key():
    import requests
    client = FirecrawlClient({"firecrawl_api_key": "SECRET-KEY-99"})
    client.retry_sleep = 0
    client._session.post = MagicMock(side_effect=requests.RequestException("boom"))
    rows = client.search("q")
    assert rows and "_error" in rows[0]
    assert "SECRET-KEY-99" not in str(rows)


def test_scrape_returns_markdown_and_links(monkeypatch):
    monkeypatch.setattr("smart_ziw_research.socket.getaddrinfo", _public_dns)
    client = FirecrawlClient({"firecrawl_api_key": "k"})
    client._session.post = MagicMock(return_value=_response(200, {"data": {
        "markdown": "# Notice", "title": "N", "url": "https://example.com",
        "links": ["https://example.com/dce.pdf"],
    }}))
    page = client.scrape("https://example.com")
    assert page["markdown"] == "# Notice"
    payload = client._session.post.call_args.kwargs["json"]
    assert payload == {"url": "https://example.com", "formats": ["markdown"], "onlyMainContent": True}


def test_scrape_blocks_unsafe_url_without_request(monkeypatch):
    monkeypatch.setattr("smart_ziw_research.socket.getaddrinfo", _private_dns)
    client = FirecrawlClient({"firecrawl_api_key": "k"})
    client._session.post = MagicMock()
    result = client.scrape("http://10.0.0.5/internal")
    assert result == {"_error": "blocked (unsafe URL)"}
    client._session.post.assert_not_called()


def test_search_without_key_returns_config_error():
    client = FirecrawlClient({})
    client._session.post = MagicMock()
    rows = client.search("q")
    assert rows == [{"_error": "firecrawl_api_key is not configured"}]
    client._session.post.assert_not_called()


from smart_ziw_research import DocumentStore, is_document_url, EvidenceCorpus


def test_is_document_url_table():
    assert is_document_url("https://x.com/dce.PDF") is True
    assert is_document_url("https://x.com/dce.pdf?download=1") is True
    assert is_document_url("https://x.com/plan.xlsx") is True
    assert is_document_url("https://x.com/notice.html") is False
    assert is_document_url("https://x.com/notice") is False


def _fake_get(content=b"%PDF-1.4 fake", status=200, content_type="application/pdf"):
    mock = MagicMock()
    mock.raise_for_status.return_value = None
    mock.headers = {"content-type": content_type}
    mock.iter_content = lambda chunk_size: iter([content])
    mock.__enter__ = lambda self: self
    mock.__exit__ = lambda *args: None
    return mock


def test_download_saves_slugged_file(monkeypatch, tmp_path):
    monkeypatch.setattr("smart_ziw_research.socket.getaddrinfo", _public_dns)
    monkeypatch.setattr("smart_ziw_research.requests.get", lambda *a, **k: _fake_get())
    store = DocumentStore(tmp_path)
    path, error = store.download("https://example.com/docs/IS Security Audit.PDF")
    assert error is None
    assert path is not None
    assert path.name == "IS-Security-Audit.pdf"
    assert path.parent == tmp_path / "documents"


def test_download_skips_existing_file(monkeypatch, tmp_path):
    monkeypatch.setattr("smart_ziw_research.socket.getaddrinfo", _public_dns)
    store = DocumentStore(tmp_path)
    target = store.documents_dir / "doc.pdf"
    target.write_bytes(b"already here")

    def _explode(*args, **kwargs):
        raise AssertionError("network should not be used")

    monkeypatch.setattr("smart_ziw_research.requests.get", _explode)
    path, error = store.download("https://example.com/doc.pdf", title="doc")
    assert error is None
    assert path == target
    assert target.read_bytes() == b"already here"


def test_download_rejects_unsafe_url(monkeypatch, tmp_path):
    monkeypatch.setattr("smart_ziw_research.socket.getaddrinfo", _private_dns)
    store = DocumentStore(tmp_path)
    path, error = store.download("http://10.0.0.5/dce.pdf")
    assert path is None
    assert error == "blocked (unsafe URL)"


def test_download_caps_file_size(monkeypatch, tmp_path):
    monkeypatch.setattr("smart_ziw_research.socket.getaddrinfo", _public_dns)
    monkeypatch.setattr("smart_ziw_research.requests.get", lambda *a, **k: _fake_get(content=b"x" * 100))
    store = DocumentStore(tmp_path, max_bytes=10)
    path, error = store.download("https://example.com/big.pdf")
    assert path is None
    assert error == "file exceeds size cap"
    assert not (store.documents_dir / "big.pdf").exists()


def test_extract_uses_pdfplumber_fallback(monkeypatch, tmp_path):
    # markitdown unavailable -> pdfplumber fallback
    monkeypatch.setitem(sys.modules, "markitdown", None)
    fake_pdf = MagicMock()
    fake_pdf.pages = [MagicMock(extract_text=lambda: "PDF page text")]
    fake_pdf.__enter__ = lambda self: self
    fake_pdf.__exit__ = lambda *args: None
    import pdfplumber
    monkeypatch.setattr(pdfplumber, "open", lambda path: fake_pdf)
    store = DocumentStore(tmp_path)
    doc = tmp_path / "dce.pdf"
    doc.write_bytes(b"fake pdf bytes")
    text = store.extract(doc)
    assert "PDF page text" in text


def test_save_extraction_writes_failure_note(monkeypatch, tmp_path):
    store = DocumentStore(tmp_path)
    monkeypatch.setattr(DocumentStore, "extract", lambda self, path: "")
    doc = store.documents_dir / "locked.pdf"
    doc.write_bytes(b"x")
    name, ok = store.save_extraction(doc)
    assert ok is False
    assert name == "locked.md"
    content = (store.artifacts_dir / name).read_text(encoding="utf-8")
    assert "Extraction failed" in content


def test_save_extraction_writes_text(monkeypatch, tmp_path):
    store = DocumentStore(tmp_path)
    monkeypatch.setattr(DocumentStore, "extract", lambda self, path: "extracted text")
    doc = store.documents_dir / "dce.pdf"
    doc.write_bytes(b"x")
    name, ok = store.save_extraction(doc)
    assert ok is True
    assert (store.artifacts_dir / name).read_text(encoding="utf-8") == "extracted text"


def test_corpus_dedupes_and_numbers():
    corpus = EvidenceCorpus()
    assert corpus.add("page", "https://example.com/a", "A", "text") is True
    assert corpus.add("page", "https://example.com/a", "A again", "text") is False
    assert corpus.add("document", "https://example.com/b.pdf", "B", "text") is True
    assert corpus.citation_number("https://example.com/a") == 1
    assert corpus.citation_number("https://example.com/b.pdf") == 2
    assert len(corpus.items) == 2


def test_corpus_dedupes_tracking_params_and_fragments():
    corpus = EvidenceCorpus()
    assert corpus.add("page", "https://example.com/p?utm_source=x", "P", "text") is True
    assert corpus.add("page", "https://example.com/p", "P2", "text") is False
    assert corpus.add("page", "https://example.com/p#section", "P3", "text") is False
    assert corpus.add("page", "https://example.com/p?ref=keep", "P4", "text") is True
    assert len(corpus.items) == 2


def test_corpus_render_log_lists_sources_failed_blocked():
    corpus = EvidenceCorpus()
    corpus.add("page", "https://official.gov.tn/notice", "Notice", "md")
    corpus.add("document", "https://official.gov.tn/dce.pdf", "DCE", "extracted")
    corpus.record_failure("https://broken.example.com/x", "download failed: Timeout")
    corpus.record_blocked("http://10.0.0.5/internal.pdf")
    log = corpus.render_log()
    assert "[1] Notice" in log
    assert "[2] DCE" in log
    assert "download failed: Timeout" in log
    assert "http://10.0.0.5/internal.pdf" in log
    assert "## Sources" in log


def test_corpus_render_log_empty():
    log = EvidenceCorpus().render_log()
    assert "No research activity recorded" in log


from smart_ziw_research import (
    ROUND_PROMPT,
    SEED_PROMPT,
    SELECT_PROMPT,
    VERDICT_PROMPT,
    DocumentStore,
    run_research,
)

PROJECT = {
    "project_name": "IS Security Audit",
    "project_sponsor": "CDC Benin",
    "primary_country_name_en": "Benin",
    "project_end_date": "2026-07-13",
    "project_url": "https://example.com/tender",
    "source": "Global Tenders",
    "project_description": "Audit and pentesting.",
}

STUB_CONFIG = {
    "firecrawl_api_key": "k",
    "smart_ziw_repo_path": "/tmp/unused",
    "smart_ziw_research_timeout_seconds": 900,
}


def _counting_call(system, user, counters, seed=None, selects=None, rounds=None, verdict=None):
    if system == SEED_PROMPT:
        counters["seed"] += 1
        return seed or {}
    if system == SELECT_PROMPT:
        counters["select"] += 1
        select = selects.pop(0) if selects else {"selected": []}
        return select
    if system == ROUND_PROMPT:
        counters["round"] += 1
        return rounds.pop(0) if rounds else {"stop": True, "next_queries": []}
    if system == VERDICT_PROMPT:
        counters["verdict"] += 1
        return verdict or {"recommendation": "MONITOR", "reasoning": "default"}
    raise AssertionError(f"unexpected prompt: {system[:60]}")


def test_run_research_converges_after_two_stops(monkeypatch, tmp_path):
    class StubClient:
        def __init__(self, config):
            self.api_key = "k"
        def search(self, query, limit=10):
            return [{"url": "https://example.com/x", "title": "X", "description": "d"}]
        def scrape(self, url):
            return {"_error": "not used"}

    monkeypatch.setattr("smart_ziw_research.FirecrawlClient", StubClient)
    counters = {"seed": 0, "select": 0, "round": 0, "verdict": 0}

    def call(system, user):
        return _counting_call(
            system, user, counters,
            seed={"queries": ["q1"], "official_domains": [], "aggregator_urls": []},
            selects=[{"selected": []}, {"selected": []}],
            rounds=[{"stop": True, "next_queries": []}, {"stop": True, "next_queries": []}],
            verdict={"recommendation": "MONITOR", "reasoning": "no sources"},
        )

    result = run_research(PROJECT, STUB_CONFIG, folder_path=tmp_path / "folder", llm_call=call)
    assert result.error == ""
    assert result.timed_out is False
    assert counters["round"] == 2
    assert result.verdict["recommendation"] == "MONITOR"
    assert result.stats["queries_run"] == 1
    assert (tmp_path / "folder" / "artifacts" / "research-log.md").exists()


def test_run_research_dedupe_exhaustion_stops(monkeypatch, tmp_path):
    class StubClient:
        def __init__(self, config):
            self.api_key = "k"
        def search(self, query, limit=10):
            return []
        def scrape(self, url):
            return {"_error": "not used"}

    monkeypatch.setattr("smart_ziw_research.FirecrawlClient", StubClient)
    counters = {"seed": 0, "select": 0, "round": 0, "verdict": 0}

    def call(system, user):
        return _counting_call(
            system, user, counters,
            seed={"queries": [], "official_domains": [], "aggregator_urls": []},
            rounds=[{"stop": False, "next_queries": []}],
        )

    result = run_research(PROJECT, STUB_CONFIG, folder_path=tmp_path / "folder", llm_call=call)
    assert result.error == ""
    assert counters["round"] == 1  # nothing left to try -> exhaustion
    assert result.verdict["recommendation"] == "MONITOR"


def test_run_research_scrapes_page_and_captures_document(monkeypatch, tmp_path):
    class StubClient:
        def __init__(self, config):
            self.api_key = "k"
        def search(self, query, limit=10):
            return [{"url": "https://example.com/notice", "title": "Notice", "description": ""}]
        def scrape(self, url):
            return {
                "markdown": "Tender notice text",
                "title": "Notice",
                "url": "https://example.com/notice",
                "links": ["https://example.com/dce.pdf"],
            }

    monkeypatch.setattr("smart_ziw_research.FirecrawlClient", StubClient)

    def fake_download(self, url, title=""):
        path = self.documents_dir / "dce.pdf"
        path.write_bytes(b"%PDF fake")
        return path, None

    def fake_save_extraction(self, doc_path):
        artifact = self.artifacts_dir / "dce.md"
        artifact.write_text("extracted text", encoding="utf-8")
        return "dce.md", True

    monkeypatch.setattr(DocumentStore, "download", fake_download)
    monkeypatch.setattr(DocumentStore, "save_extraction", fake_save_extraction)
    counters = {"seed": 0, "select": 0, "round": 0, "verdict": 0}

    def call(system, user):
        return _counting_call(
            system, user, counters,
            seed={"queries": [], "official_domains": [], "aggregator_urls": []},
            selects=[{"selected": [{"url": "https://example.com/notice", "reason": "official"}]},
                     {"selected": []}],
            rounds=[{"stop": True, "next_queries": []}, {"stop": True, "next_queries": []}],
            verdict={"recommendation": "GO", "reasoning": "live tender [1]"},
        )

    result = run_research(PROJECT, STUB_CONFIG, folder_path=tmp_path / "folder", llm_call=call)
    assert result.error == ""
    assert result.stats["pages_scraped"] == 1
    assert result.stats["documents_captured"] == 1
    assert len(result.items) == 2
    assert result.citation_map[EvidenceCorpus.normalize_url("https://example.com/notice")] == 1
    assert result.verdict["recommendation"] == "GO"
    assert (tmp_path / "folder" / "artifacts" / "page-1.md").exists()
    assert (tmp_path / "folder" / "documents" / "dce.pdf").exists()
    assert (tmp_path / "folder" / "artifacts" / "dce.md").exists()


def test_run_research_times_out(monkeypatch, tmp_path):
    class StubClient:
        def __init__(self, config):
            self.api_key = "k"
        def search(self, query, limit=10):
            return []
        def scrape(self, url):
            return {"_error": "not used"}

    monkeypatch.setattr("smart_ziw_research.FirecrawlClient", StubClient)
    counters = {"seed": 0, "select": 0, "round": 0, "verdict": 0}

    def call(system, user):
        return _counting_call(system, user, counters, seed={"queries": [], "official_domains": [], "aggregator_urls": []})

    config = dict(STUB_CONFIG, smart_ziw_research_timeout_seconds=-1)
    result = run_research(PROJECT, config, folder_path=tmp_path / "folder", llm_call=call)
    assert result.timed_out is True
    assert result.error == ""
    assert counters["round"] == 0


def test_run_research_no_key_returns_error(monkeypatch, tmp_path):
    counters = {"seed": 0, "select": 0, "round": 0, "verdict": 0}

    def call(system, user):
        counters["seed"] += 1
        return {}

    result = run_research(PROJECT, {"smart_ziw_repo_path": "/tmp/x"}, folder_path=tmp_path / "f", llm_call=call)
    assert result.error == "firecrawl_api_key is not configured"
    assert counters["seed"] == 0
