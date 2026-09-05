import sys
from pathlib import Path
from unittest.mock import MagicMock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from smart_ziw_research import (
    CorpusItem,
    DocumentStore,
    EvidenceCorpus,
    FirecrawlClient,
    RECAP_SYNTHESIS_PROMPT,
    ResearchResult,
    ROUND_PROMPT,
    SEED_PROMPT,
    SELECT_PROMPT,
    SOURCE_DISCOVERY_PROMPT,
    SOURCE_RANKING_PROMPT,
    SUMMARIZE_PROMPT,
    VERDICT_PROMPT,
    is_document_url,
    run_research,
    synthesize,
    url_is_safe,
)


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


def test_search_returns_mcp_results(monkeypatch):
    monkeypatch.setattr(
        "smart_ziw_research._find_firecrawl_mcp_server",
        lambda: ("firecrawl", "Firecrawl"),
    )
    monkeypatch.setattr(
        "smart_ziw_research._call_firecrawl_tool",
        lambda tool, args: {"content": [{"title": "T", "url": "https://example.com", "description": "D"}]},
    )
    client = FirecrawlClient({})
    rows = client.search("tender query")
    assert rows[0]["url"] == "https://example.com"


def test_scrape_returns_mcp_markdown(monkeypatch):
    monkeypatch.setattr("smart_ziw_research.socket.getaddrinfo", _public_dns)
    monkeypatch.setattr(
        "smart_ziw_research._find_firecrawl_mcp_server",
        lambda: ("firecrawl", "Firecrawl"),
    )
    monkeypatch.setattr(
        "smart_ziw_research._call_firecrawl_tool",
        lambda tool, args: {"content": {"markdown": "# Notice", "title": "N", "url": args["url"], "links": ["https://example.com/dce.pdf"]}},
    )
    client = FirecrawlClient({})
    page = client.scrape("https://example.com")
    assert page["markdown"] == "# Notice"


def test_scrape_blocks_unsafe_url_without_request(monkeypatch):
    monkeypatch.setattr("smart_ziw_research.socket.getaddrinfo", _private_dns)
    monkeypatch.setattr(
        "smart_ziw_research._find_firecrawl_mcp_server",
        lambda: ("firecrawl", "Firecrawl"),
    )
    called = {"n": 0}
    def _no_call(tool, args):
        called["n"] += 1
        return {}
    monkeypatch.setattr("smart_ziw_research._call_firecrawl_tool", _no_call)
    client = FirecrawlClient({})
    result = client.scrape("http://10.0.0.5/internal")
    assert result == {"_error": "blocked (unsafe URL)"}
    assert called["n"] == 0


def test_search_without_mcp_server_uses_http_fallback(monkeypatch):
    monkeypatch.setattr("smart_ziw_research._find_firecrawl_mcp_server", lambda: None)
    monkeypatch.setattr(
        "smart_ziw_research.FirecrawlClient._http_search",
        lambda self, query, limit=10: [{"url": "https://ddg.example/1", "title": "T"}],
    )
    client = FirecrawlClient({})
    rows = client.search("q")
    assert rows[0]["url"] == "https://ddg.example/1"


def test_http_scrape_fallback_extracts_text_and_links(monkeypatch):
    html = (
        "<html><head><title>Notice</title></head><body>"
        "<script>bad()</script><p>Hello tender</p>"
        '<a href="/files/dce.pdf">DCE</a></body></html>'
    )

    class FakeResp:
        status_code = 200
        headers = {"content-type": "text/html; charset=utf-8"}
        text = html

    monkeypatch.setattr("smart_ziw_research.requests.get", lambda *a, **k: FakeResp())
    client = FirecrawlClient({})
    page = client._http_scrape("https://example.com/notice")
    assert page["title"] == "Notice"
    assert "Hello tender" in page["markdown"]
    assert "bad()" not in page["markdown"]
    assert "https://example.com/files/dce.pdf" in page["links"]


def test_http_search_fallback_parses_ddg_html(monkeypatch):
    html = (
        '<div class="result">'
        '<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fbhn.ne%2Fao">BHN AO</a>'
        '<a class="result__snippet">Avis d appel d offres</a>'
        "</div>"
    )

    class FakeResp:
        status_code = 200
        text = html

    monkeypatch.setattr("smart_ziw_research.requests.get", lambda *a, **k: FakeResp())
    client = FirecrawlClient({})
    rows = client._http_search("BHN appel d offres")
    assert rows == [{
        "url": "https://bhn.ne/ao",
        "title": "BHN AO",
        "description": "Avis d appel d offres",
    }]


def test_http_search_fallback_empty_on_failure(monkeypatch):
    def _boom(*a, **k):
        raise OSError("no network")
    monkeypatch.setattr("smart_ziw_research.requests.get", _boom)
    client = FirecrawlClient({})
    assert client._http_search("q") == []



def test_is_document_url_table():
    assert is_document_url("https://x.com/dce.PDF") is True
    assert is_document_url("https://x.com/dce.pdf?download=1") is True
    assert is_document_url("https://x.com/plan.xlsx") is True
    assert is_document_url("https://x.com/notice.html") is False
    assert is_document_url("https://x.com/notice") is False


def test_find_source_rejects_aggregator_domain():
    from smart_ziw_research import find_source

    def call(system, user):
        return {
            "source_url": "https://example.com/tender/notice",
            "buyer": "CDC Benin",
            "requesting_company": "CDC Benin",
            "confidence": "high",
            "document_urls": [],
            "notes": "listing is on the aggregator",
        }

    result = find_source(PROJECT, STUB_CONFIG, llm_call=call)
    assert result.source_url == ""
    assert result.confidence == "low"
    assert "aggregator" in (result.notes or "").lower()
    assert result.buyer == "CDC Benin"


def test_find_source_keeps_buyer_domain():
    from smart_ziw_research import find_source

    def call(system, user):
        return {
            "source_url": "https://buyer.gov.ne/notice",
            "buyer": "CDC Benin",
            "requesting_company": "CDC Benin",
            "confidence": "high",
            "document_urls": [],
            "notes": "official portal",
        }

    result = find_source(PROJECT, STUB_CONFIG, llm_call=call)
    assert result.source_url == "https://buyer.gov.ne/notice"
    assert result.confidence == "high"


def test_find_source_derives_buyer_domain_from_email():
    from smart_ziw_research import find_source

    def call(system, user):
        return {"source_url": "", "buyer": "Banque de l'Habitat du Niger",
                "requesting_company": "", "confidence": "low", "notes": ""}

    project = dict(PROJECT)
    project["project_description"] = (
        "Les offres doivent être envoyées par email à achats@bhn.ne "
        "ou infos@bhn.ne avant le 04/09/2026."
    )
    result = find_source(project, STUB_CONFIG, llm_call=call)
    assert result.source_url == "https://bhn.ne"
    assert result.confidence == "medium"
    assert "email" in (result.notes or "").lower()


def test_find_source_email_derivation_skips_aggregator_and_free_mail():
    from smart_ziw_research import find_source

    def call(system, user):
        return {"source_url": "", "buyer": "CDC Benin", "requesting_company": "",
                "confidence": "low", "notes": ""}

    project = dict(PROJECT)
    project["project_description"] = (
        "Contact: cdc@example.com ou cdc.benin@gmail.com — aucune autre adresse."
    )
    result = find_source(project, STUB_CONFIG, llm_call=call)
    assert result.source_url == ""
    assert result.confidence == "low"


def test_scrub_aggregator_source_replaces_url_and_states_gap():
    from smart_ziw_research import ResearchResult, _scrub_aggregator_source

    project = dict(PROJECT)
    research = ResearchResult()
    research.buyer = "CDC Benin"
    out = {
        "recap_markdown": (
            "**Source**\n- Original listing: Tender X [1]\n\n"
            "Source: [Aggregator](https://example.com/tender)"
        ),
    }
    _scrub_aggregator_source(out, project, research)
    md = out["recap_markdown"]
    assert "https://example.com/tender" not in md
    assert "[Aggregator]" not in md
    assert "not the original source" in md
    assert "## Original source" in md
    assert "CDC Benin" in md


def test_scrub_aggregator_source_noop_when_source_found():
    from smart_ziw_research import ResearchResult, _scrub_aggregator_source

    project = dict(PROJECT)
    research = ResearchResult()
    research.source_url = "https://buyer.gov.ne/notice"
    out = {"recap_markdown": "Source: [Buyer](https://buyer.gov.ne/notice)"}
    _scrub_aggregator_source(out, project, research)
    assert out["recap_markdown"] == "Source: [Buyer](https://buyer.gov.ne/notice)"


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
    assert path.parent == tmp_path / "files" / "original"


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


def test_download_dedupes_identical_content_across_titles(monkeypatch, tmp_path):
    monkeypatch.setattr("smart_ziw_research.socket.getaddrinfo", _public_dns)
    monkeypatch.setattr("smart_ziw_research.requests.get", lambda *a, **k: _fake_get())
    store = DocumentStore(tmp_path)
    first, error = store.download("https://example.com/dce.pdf", title="Tender document")
    assert error is None
    # Second run hits the same bytes under a different slug -> must reuse.
    second, error = store.download("https://example.com/dce.pdf", title="Official notice DCE")
    assert error is None
    assert second == first
    originals = sorted((tmp_path / "files" / "original").iterdir())
    assert len(originals) == 1
    listed = store.list_files()
    assert listed == ["files/original/Tender-document.pdf"]
    assert len(store.downloads) == 1


def test_download_dedupes_against_files_from_previous_run(monkeypatch, tmp_path):
    monkeypatch.setattr("smart_ziw_research.socket.getaddrinfo", _public_dns)
    monkeypatch.setattr("smart_ziw_research.requests.get", lambda *a, **k: _fake_get())
    first_store = DocumentStore(tmp_path)
    first, error = first_store.download("https://example.com/dce.pdf", title="Tender document")
    assert error is None

    second_store = DocumentStore(tmp_path)  # fresh store = second agent run
    second, error = second_store.download("https://example.com/dce.pdf", title="Buyer notice")
    assert error is None
    assert second == first
    assert sorted(p.name for p in (tmp_path / "files" / "original").iterdir()) == ["Tender-document.pdf"]
    assert second_store.list_files() == ["files/original/Tender-document.pdf"]


def test_download_same_title_second_run_skips_network(monkeypatch, tmp_path):
    # Realistic second run: same phase-1 title slug -> early return, no fetch.
    monkeypatch.setattr("smart_ziw_research.socket.getaddrinfo", _public_dns)
    monkeypatch.setattr("smart_ziw_research.requests.get", lambda *a, **k: _fake_get())
    DocumentStore(tmp_path).download("https://example.com/dce.pdf", title="Tender document")

    def _explode(*args, **kwargs):
        raise AssertionError("network should not be used")

    monkeypatch.setattr("smart_ziw_research.requests.get", _explode)
    store = DocumentStore(tmp_path)
    path, error = store.download("https://example.com/dce.pdf", title="Tender document")
    assert error is None
    assert path.name == "Tender-document.pdf"
    assert store.list_files() == ["files/original/Tender-document.pdf"]


def test_download_keeps_distinct_content_under_unique_names(monkeypatch, tmp_path):
    monkeypatch.setattr("smart_ziw_research.socket.getaddrinfo", _public_dns)
    payloads = iter([b"%PDF-1.4 first", b"%PDF-1.4 second version"])
    monkeypatch.setattr(
        "smart_ziw_research.requests.get", lambda *a, **k: _fake_get(content=next(payloads))
    )
    store = DocumentStore(tmp_path)
    first, error = store.download("https://example.com/dce.pdf", title="Tender document")
    assert error is None
    second, error = store.download("https://example.com/dce.pdf", title="Buyer notice")
    assert error is None
    assert second != first
    assert first.read_bytes() == b"%PDF-1.4 first"
    assert second.read_bytes() == b"%PDF-1.4 second version"
    assert sorted(store.list_files()) == [
        "files/original/Buyer-notice.pdf",
        "files/original/Tender-document.pdf",
    ]


def test_save_extraction_dedupes_identical_content(monkeypatch, tmp_path):
    store = DocumentStore(tmp_path)
    monkeypatch.setattr(DocumentStore, "extract", lambda self, path: "extracted text")
    doc = store.documents_dir / "dce.pdf"
    doc.write_bytes(b"x")
    path1, ok1 = store.save_extraction(doc)
    path2, ok2 = store.save_extraction(doc)
    assert (path1, ok1) == (path2, ok2) == (store.extracted_dir / "dce.md", True)
    assert store.list_files().count("files/extracted/dce.md") == 1


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
    extracted_path, ok = store.save_extraction(doc)
    assert ok is False
    assert extracted_path == store.extracted_dir / "locked.md"
    content = extracted_path.read_text(encoding="utf-8")
    assert "Extraction failed" in content


def test_save_extraction_writes_text(monkeypatch, tmp_path):
    store = DocumentStore(tmp_path)
    monkeypatch.setattr(DocumentStore, "extract", lambda self, path: "extracted text")
    doc = store.documents_dir / "dce.pdf"
    doc.write_bytes(b"x")
    extracted_path, ok = store.save_extraction(doc)
    assert ok is True
    assert extracted_path.read_text(encoding="utf-8") == "extracted text"


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
    RECAP_SYNTHESIS_PROMPT,
    ROUND_PROMPT,
    SEED_PROMPT,
    SELECT_PROMPT,
    SOURCE_DISCOVERY_PROMPT,
    SUMMARIZE_PROMPT,
    VERDICT_PROMPT,
    CorpusItem,
    DocumentStore,
    EvidenceCorpus,
    FirecrawlClient,
    ResearchResult,
    is_document_url,
    run_research,
    synthesize,
    url_is_safe,
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
    "smart_ziw_repo_path": "/tmp/unused",
    "smart_ziw_research_timeout_seconds": 900,
}


def _counting_call(system, user, counters, seed=None, selects=None, rounds=None, verdict=None, source=None, source_ranking=None):
    if system == SOURCE_DISCOVERY_PROMPT:
        return source or {
            "source_url": "",
            "buyer": "",
            "requesting_company": "",
            "confidence": "low",
            "document_urls": [],
            "notes": "",
        }
    if system == SOURCE_RANKING_PROMPT:
        return source_ranking or {
            "source_url": "",
            "buyer": "",
            "requesting_company": "",
            "confidence": "low",
            "document_urls": [],
            "notes": "",
        }
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
        return verdict or {"recommendation": "GO-CONDITIONAL", "reasoning": "default"}
    raise AssertionError(f"unexpected prompt: {system[:60]}")


def test_run_research_converges_after_two_stops(monkeypatch, tmp_path):
    class StubClient:
        def __init__(self, config):
            self.api_key = "k"
            self.available = True
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
    assert result.verdict["recommendation"] == "GO-CONDITIONAL"
    assert result.stats["queries_run"] == 1


def test_run_research_dedupe_exhaustion_stops(monkeypatch, tmp_path):
    class StubClient:
        def __init__(self, config):
            self.api_key = "k"
            self.available = True
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
    assert result.verdict["recommendation"] == "GO-CONDITIONAL"


def test_run_research_scrapes_page_and_captures_document(monkeypatch, tmp_path):
    class StubClient:
        def __init__(self, config):
            self.api_key = "k"
            self.available = True
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
        extracted = self.extracted_dir / "dce.md"
        extracted.write_text("extracted text", encoding="utf-8")
        return extracted, True

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
    assert (tmp_path / "folder" / "files" / "original" / "dce.pdf").exists()
    assert (tmp_path / "folder" / "files" / "extracted" / "dce.md").exists()


def test_run_research_times_out(monkeypatch, tmp_path):
    class StubClient:
        def __init__(self, config):
            self.api_key = "k"
            self.available = True
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


def test_run_research_without_mcp_server_proceeds(monkeypatch, tmp_path):
    counters = {"seed": 0}

    def call(system, user):
        if system == SEED_PROMPT:
            counters["seed"] += 1
        return {}

    monkeypatch.setattr("smart_ziw_research._find_firecrawl_mcp_server", lambda: None)
    monkeypatch.setattr(
        "smart_ziw_research.FirecrawlClient._http_search",
        lambda self, query, limit=10: [],
    )
    result = run_research(PROJECT, {"smart_ziw_repo_path": "/tmp/x"}, folder_path=tmp_path / "f", llm_call=call)
    assert result.error == ""
    assert counters["seed"] == 1




def _make_research(num_items: int) -> ResearchResult:
    corpus = EvidenceCorpus()
    for index in range(num_items):
        corpus.add("page", f"https://example.com/p{index}", f"P{index}", f"content {index}")
    return ResearchResult(items=corpus.items, citation_map=corpus.citation_map())


RECAP_FULL = {
    "recap_markdown": "# Tender Recap\n\nVerified [1]\n\nGO",
    "references": [{"number": 1, "title": "Example", "url_or_path": "https://example.com"}],
}


def test_synthesize_chunks_and_returns_coerced_dict():
    research = _make_research(10)  # 2 chunks of 8
    research.source_url = "https://buyer.gov.ne/notice"  # keeps the scrub out of the assert
    calls = {"summarize": 0, "final": 0}

    def call(system, user):
        if system == SUMMARIZE_PROMPT:
            calls["summarize"] += 1
            return {"summaries": [{"citation": 1, "summary": "s"}]}
        if system == RECAP_SYNTHESIS_PROMPT:
            calls["final"] += 1
            return RECAP_FULL
        raise AssertionError(f"unexpected prompt: {system[:60]}")

    result = synthesize(PROJECT, research, llm_call=call)
    assert calls["summarize"] == 2
    assert calls["final"] == 1
    assert result["recap_markdown"] == (
        "# Tender Recap\n\nVerified [1]\n\nGO"
        "\n\n---\n\n## Original source\n"
        "- [Original source](https://buyer.gov.ne/notice)"
    )
    assert result["references"][0]["url_or_path"] == "https://buyer.gov.ne/notice"
    assert result["references"][1]["url_or_path"] == "https://example.com"


def test_synthesize_coerces_bad_fields_to_safe_defaults():
    research = _make_research(0)

    def call(system, user):
        if system == SUMMARIZE_PROMPT:
            raise AssertionError("no chunks expected")
        if system == RECAP_SYNTHESIS_PROMPT:
            return {"recap_markdown": "bad", "references": "not-a-list"}
        raise AssertionError(f"unexpected prompt: {system[:60]}")

    result = synthesize(PROJECT, research, llm_call=call)
    assert "# Tender Recap" in result["recap_markdown"]
    assert "GO-CONDITIONAL" in result["recap_markdown"]
    assert isinstance(result["references"], list)


def test_synthesize_llm_failure_returns_error_dict():
    research = _make_research(2)

    def call(system, user):
        raise RuntimeError("DeepSeek down")

    result = synthesize(PROJECT, research, llm_call=call)
    assert "_error" in result
    assert "LLM synthesis failed" in result["_error"]


# ---------- Final review regression tests (I1/I2/I3, M1/M2/M4/M7) ----------


def test_url_is_safe_rejects_malformed_ports():
    # I2: parsed.port must not raise on ":abc" or out-of-range ports.
    assert url_is_safe("http://example.com:abc/path") is False
    assert url_is_safe("http://example.com:99999/path") is False


def test_url_is_safe_rejects_more_private_ranges(monkeypatch):
    # M4: 0.0.0.0/8, 100.64.0.0/10, 192.0.0.0/24, 198.18.0.0/15, 224.0.0.0/4.
    def _echo_dns(host, port):
        return [(2, 1, 6, "", (host, port))]

    monkeypatch.setattr("smart_ziw_research.socket.getaddrinfo", _echo_dns)
    assert url_is_safe("http://0.0.0.0/x.pdf") is False
    assert url_is_safe("http://100.64.0.1/x.pdf") is False
    assert url_is_safe("http://192.0.0.1/x.pdf") is False
    assert url_is_safe("http://198.18.0.1/x.pdf") is False
    assert url_is_safe("http://224.0.0.1/x.pdf") is False
    assert url_is_safe("http://8.8.8.8/x.pdf") is True  # public still allowed


def test_download_blocks_redirect_to_private_url(monkeypatch, tmp_path):
    # I1: a public-looking URL that 302-redirects to loopback must be blocked.
    def _mixed_dns(host, port):
        if host == "127.0.0.1":
            return [(2, 1, 6, "", ("127.0.0.1", port))]
        return [(2, 1, 6, "", ("8.8.8.8", port))]

    monkeypatch.setattr("smart_ziw_research.socket.getaddrinfo", _mixed_dns)
    redirect = MagicMock()
    redirect.status_code = 302
    redirect.headers = {"Location": "http://127.0.0.1/secret.pdf"}
    get = MagicMock(return_value=redirect)
    monkeypatch.setattr("smart_ziw_research.requests.get", get)
    store = DocumentStore(tmp_path)
    path, error = store.download("https://example.com/file.pdf")
    assert path is None
    assert error == "blocked (unsafe URL)"
    get.assert_called_once()
    assert get.call_args.kwargs["allow_redirects"] is False


def test_run_research_none_timeout_still_proceeds(monkeypatch, tmp_path):
    # I3: timeout coercion must not raise when the config value is None.
    counters = {"seed": 0}

    def call(system, user):
        if system == SEED_PROMPT:
            counters["seed"] += 1
        return {}

    monkeypatch.setattr("smart_ziw_research._find_firecrawl_mcp_server", lambda: None)
    monkeypatch.setattr(
        "smart_ziw_research.FirecrawlClient._http_search",
        lambda self, query, limit=10: [],
    )
    result = run_research(
        PROJECT,
        {"smart_ziw_research_timeout_seconds": None},
        folder_path=tmp_path / "f",
        llm_call=call,
    )
    assert result.error == ""
    assert counters["seed"] == 1


def test_run_research_document_stats_count_only_new_urls(monkeypatch, tmp_path):
    # M1: duplicate document links in one scrape result count once.
    class StubClient:
        def __init__(self, config):
            self.api_key = "k"
            self.available = True

        def search(self, query, limit=10):
            return [{"url": "https://example.com/notice", "title": "Notice", "description": ""}]

        def scrape(self, url):
            return {
                "markdown": "Tender notice text",
                "title": "Notice",
                "url": "https://example.com/notice",
                "links": ["https://example.com/dce.pdf", "https://example.com/dce.pdf"],
            }

    monkeypatch.setattr("smart_ziw_research.FirecrawlClient", StubClient)

    def fake_download(self, url, title=""):
        path = self.documents_dir / "dce.pdf"
        path.write_bytes(b"%PDF fake")
        return path, None

    def fake_save_extraction(self, doc_path):
        extracted = self.extracted_dir / "dce.md"
        extracted.write_text("extracted text", encoding="utf-8")
        return extracted, True

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
            verdict={"recommendation": "MONITOR", "reasoning": "default"},
        )

    result = run_research(PROJECT, STUB_CONFIG, folder_path=tmp_path / "folder", llm_call=call)
    assert result.error == ""
    assert result.stats["documents_captured"] == 1
    doc_items = [item for item in result.items if item.kind == "document"]
    assert len(doc_items) == 1


def test_run_research_verdict_whitelisted(monkeypatch, tmp_path):
    # M2: only GO / NO-GO / GO-CONDITIONAL are valid; others collapse to GO-CONDITIONAL.
    class StubClient:
        def __init__(self, config):
            self.api_key = "k"
            self.available = True

        def search(self, query, limit=10):
            return [{"url": "https://example.com/notice", "title": "Notice", "description": ""}]

        def scrape(self, url):
            return {"markdown": "Tender notice text", "title": "Notice",
                    "url": "https://example.com/notice", "links": []}

    monkeypatch.setattr("smart_ziw_research.FirecrawlClient", StubClient)
    counters = {"seed": 0, "select": 0, "round": 0, "verdict": 0}

    def call(system, user):
        return _counting_call(
            system, user, counters,
            seed={"queries": [], "official_domains": [], "aggregator_urls": []},
            selects=[{"selected": [{"url": "https://example.com/notice", "reason": "official"}]},
                     {"selected": []}],
            rounds=[{"stop": True, "next_queries": []}, {"stop": True, "next_queries": []}],
            verdict={"recommendation": "MAYBE", "reasoning": "not sure"},
        )

    result = run_research(PROJECT, STUB_CONFIG, folder_path=tmp_path / "folder", llm_call=call)
    assert result.error == ""
    assert counters["verdict"] == 1
    assert result.verdict["recommendation"] == "GO-CONDITIONAL"
    assert result.verdict["reasoning"] == "not sure"


def test_run_research_writes_log_on_exception(monkeypatch, tmp_path):
    # M7: research-log.md is written even when a mid-research exception aborts.
    class StubClient:
        def __init__(self, config):
            self.api_key = "k"
            self.available = True

        def search(self, query, limit=10):
            return [{"url": "https://example.com/notice", "title": "Notice", "description": ""}]

        def scrape(self, url):
            return {"markdown": "Tender notice text", "title": "Notice",
                    "url": "https://example.com/notice", "links": []}

    monkeypatch.setattr("smart_ziw_research.FirecrawlClient", StubClient)
    calls = {"select": 0}

    def call(system, user):
        if system == SEED_PROMPT:
            return {"queries": [], "official_domains": [], "aggregator_urls": []}
        if system == SELECT_PROMPT:
            calls["select"] += 1
            if calls["select"] == 2:
                raise RuntimeError("boom mid-research")
            return {"selected": [{"url": "https://example.com/notice", "reason": "official"}]}
        if system == ROUND_PROMPT:
            return {"stop": True, "next_queries": []}
        raise AssertionError(f"unexpected prompt: {system[:60]}")

    result = run_research(PROJECT, STUB_CONFIG, folder_path=tmp_path / "folder", llm_call=call)
    assert result.error == "research failed: boom mid-research"
    # Artifact logs are no longer persisted to disk.
    assert not (tmp_path / "folder" / "artifacts" / "research-log.md").exists()


def test_extract_archive_zip_recursively(tmp_path):
    import zipfile
    store = DocumentStore(tmp_path)
    archive = store.documents_dir / "bundle.zip"
    with zipfile.ZipFile(archive, "w") as zf:
        zf.writestr("nested/nested.tar.gz", b"\x1f\x8b\x08\x00" + b"\x00" * 9)  # invalid gzip
        zf.writestr("readme.txt", "hello")
    extracted = store.extract_archive(archive)
    assert any(p.name == "readme.txt" for p in extracted)
    notes = store.archives
    assert any(a["name"] == "bundle.zip" for a in notes)


def test_document_store_builds_notes_in_memory(tmp_path, monkeypatch):
    monkeypatch.setattr("smart_ziw_research.socket.getaddrinfo", _public_dns)
    monkeypatch.setattr("smart_ziw_research.requests.get", lambda *a, **k: _fake_get())
    store = DocumentStore(tmp_path)
    path, _ = store.download("https://example.com/file.PDF")
    store.save_extraction(path)
    store.write_notes(PROJECT)
    notes = store.notes
    assert "file.pdf" in notes.lower()
    assert "recursive" in notes.lower()
    assert "files_downloaded" not in notes


def test_thread_context_included_in_seed_prompt(monkeypatch, tmp_path):
    class StubClient:
        def __init__(self, config):
            self.api_key = "k"
            self.available = True
        def search(self, query, limit=10):
            return []
        def scrape(self, url):
            return {"_error": "not used"}

    monkeypatch.setattr("smart_ziw_research.FirecrawlClient", StubClient)
    seen = {}

    def call(system, user):
        if system == SEED_PROMPT:
            seen["user"] = user
            return {"queries": [], "official_domains": [], "aggregator_urls": []}
        if system == SELECT_PROMPT:
            return {"selected": []}
        if system == ROUND_PROMPT:
            return {"stop": True, "next_queries": []}
        if system == VERDICT_PROMPT:
            return {"recommendation": "GO-CONDITIONAL", "reasoning": "no sources"}
        raise AssertionError(f"unexpected prompt: {system[:60]}")

    run_research(PROJECT, STUB_CONFIG, folder_path=tmp_path / "folder", llm_call=call, thread_context="user asked for pricing")
    assert "user asked for pricing" in seen["user"]


# ---------- Tool-loop handlers (Task 5) ----------

import asyncio

import requests


def _brave_payload(results=None):
    return {"grounding": {"generic": results or []}}


def test_brave_search_uses_api_key_and_params(monkeypatch):
    captured = {}

    def _fake_get(url, headers=None, params=None, timeout=None):
        captured["url"] = url
        captured["headers"] = headers
        captured["params"] = params
        return MagicMock(json=lambda: _brave_payload())

    monkeypatch.setattr("smart_ziw_research.requests.get", _fake_get)
    from smart_ziw_research import brave_search

    result = brave_search("tender niger", "secret-key", count=5)
    assert result["status"] == "ok"
    assert result["results"] == []
    assert captured["url"] == "https://api.search.brave.com/res/v1/llm/context"
    assert captured["headers"]["X-Subscription-Token"] == "secret-key"
    assert captured["params"] == {"q": "tender niger", "count": 5}


def test_brave_search_returns_results(monkeypatch):
    payload = _brave_payload([
        {"title": "Tender notice", "url": "https://bhn.ne/ao/1", "snippets": ["Appel d'offres", "Deadline 2026-10"]},
        {"title": "No snippets", "url": "https://example.com/x"},
    ])

    class FakeResp:
        def raise_for_status(self):
            return None

        def json(self):
            return payload

    monkeypatch.setattr("smart_ziw_research.requests.get", lambda *a, **k: FakeResp())
    from smart_ziw_research import brave_search

    result = brave_search("q", "k")
    assert result["status"] == "ok"
    assert result["results"][0] == {
        "title": "Tender notice",
        "url": "https://bhn.ne/ao/1",
        "snippet": "Appel d'offres\nDeadline 2026-10",
    }
    assert result["results"][1]["snippet"] == ""


def test_probe_brave_api_reports_ok_and_error(monkeypatch):
    from smart_ziw_research import probe_brave_api

    class FakeResp:
        def raise_for_status(self):
            return None

    monkeypatch.setattr("smart_ziw_research.requests.get", lambda *a, **k: FakeResp())
    assert probe_brave_api("k")["status"] == "ok"
    assert probe_brave_api("")["status"] == "error"

    def _explode(*a, **k):
        raise RuntimeError("network down")

    monkeypatch.setattr("smart_ziw_research.requests.get", _explode)
    assert probe_brave_api("k")["status"] == "error"


def test_brave_search_missing_key_returns_error_without_network(monkeypatch):
    def _explode(*a, **k):
        raise AssertionError("network should not be used")

    monkeypatch.setattr("smart_ziw_research.requests.get", _explode)
    from smart_ziw_research import brave_search

    result = brave_search("q", "")
    assert result["status"] == "error"
    assert "API key" in result["error"]
    assert result["results"] == []


def test_brave_search_http_error_returns_error_dict(monkeypatch):
    class Boom:
        def raise_for_status(self):
            raise requests.HTTPError("429 too many requests")

    monkeypatch.setattr("smart_ziw_research.requests.get", lambda *a, **k: Boom())
    from smart_ziw_research import brave_search

    result = brave_search("q", "k")
    assert result["status"] == "error"
    assert "brave search failed" in result["error"]


def test_handle_brave_web_search_ok(monkeypatch):
    monkeypatch.setattr(
        "smart_ziw_config.load_smart_ziw_config",
        lambda: {"brave_api_key": "cfg-key"},
    )
    captured = {}

    def _fake_get(url, headers=None, params=None, timeout=None):
        captured["headers"] = headers
        captured["params"] = params
        return MagicMock(json=lambda: _brave_payload([
            {"title": "T", "url": "https://example.com", "description": "d"},
        ]))

    monkeypatch.setattr("smart_ziw_research.requests.get", _fake_get)
    from smart_ziw_research import handle_brave_web_search

    result = asyncio.run(handle_brave_web_search({"query": "q", "count": 3}))
    assert result["status"] == "ok"
    assert result["results"][0]["url"] == "https://example.com"
    assert captured["headers"]["X-Subscription-Token"] == "cfg-key"
    assert captured["params"] == {"q": "q", "count": 3}


def test_handle_brave_web_search_missing_query(monkeypatch):
    monkeypatch.setattr("smart_ziw_config.load_smart_ziw_config", lambda: {})
    from smart_ziw_research import handle_brave_web_search

    result = asyncio.run(handle_brave_web_search({}))
    assert result["status"] == "error"
    assert "query" in result["error"]


def test_handle_derive_buyer_site_ok(monkeypatch):
    project = dict(PROJECT)
    project["project_description"] = "Contact: achats@bhn.ne avant le 04/09/2026."
    monkeypatch.setattr("database.get_project_by_db_id", lambda tid: project)
    from smart_ziw_research import handle_derive_buyer_site

    result = asyncio.run(handle_derive_buyer_site({"tender_id": "507f1f77bcf86cd799439011"}))
    assert result["status"] == "ok"
    assert result["url"] == "https://bhn.ne"
    assert "email" in result["note"]


def test_handle_derive_buyer_site_tender_not_found(monkeypatch):
    monkeypatch.setattr("database.get_project_by_db_id", lambda tid: None)
    from smart_ziw_research import handle_derive_buyer_site

    result = asyncio.run(handle_derive_buyer_site({"tender_id": "missing"}))
    assert result["status"] == "error"
    assert "not found" in result["error"]


def test_handle_derive_buyer_site_no_emails(monkeypatch):
    monkeypatch.setattr("database.get_project_by_db_id", lambda tid: dict(PROJECT))
    from smart_ziw_research import handle_derive_buyer_site

    result = asyncio.run(handle_derive_buyer_site({"tender_id": "id"}))
    assert result["status"] == "error"
    assert "emails" in result["error"]


def test_handle_scrape_page_ok(monkeypatch):
    class StubClient:
        def __init__(self, config):
            self.config = config

        def scrape(self, url):
            return {
                "title": "Notice",
                "markdown": "# Notice text",
                "links": ["https://example.com/dce.pdf"],
            }

    monkeypatch.setattr("smart_ziw_research.FirecrawlClient", StubClient)
    monkeypatch.setattr("smart_ziw_config.load_smart_ziw_config", lambda: {})
    from smart_ziw_research import handle_scrape_page

    result = asyncio.run(handle_scrape_page({"url": "https://example.com/notice"}))
    assert result["status"] == "ok"
    assert result["title"] == "Notice"
    assert result["markdown"] == "# Notice text"
    assert result["links"] == ["https://example.com/dce.pdf"]


def test_handle_scrape_page_error(monkeypatch):
    class StubClient:
        def __init__(self, config):
            self.config = config

        def scrape(self, url):
            return {"_error": "blocked (unsafe URL)"}

    monkeypatch.setattr("smart_ziw_research.FirecrawlClient", StubClient)
    monkeypatch.setattr("smart_ziw_config.load_smart_ziw_config", lambda: {})
    from smart_ziw_research import handle_scrape_page

    result = asyncio.run(handle_scrape_page({"url": "http://10.0.0.5/internal"}))
    assert result["status"] == "error"
    assert "blocked" in result["error"]


def test_handle_find_documents_filters_links(monkeypatch):
    class StubClient:
        def __init__(self, config):
            self.config = config

        def scrape(self, url):
            return {
                "title": "Notice",
                "links": [
                    "https://example.com/dce.pdf",
                    "https://example.com/dce.pdf?download=1",
                    "https://example.com/plan.xlsx",
                    "https://example.com/notice.html",
                    "https://example.com/bundle.zip",
                    "https://example.com/plain",
                ],
            }

    monkeypatch.setattr("smart_ziw_research.FirecrawlClient", StubClient)
    monkeypatch.setattr("smart_ziw_config.load_smart_ziw_config", lambda: {})
    from smart_ziw_research import handle_find_documents

    result = asyncio.run(handle_find_documents({
        "source_url": "https://example.com/notice",
        "tender_title": "IS Security Audit",
        "tender_reference": "REF-1",
    }))
    assert result["status"] == "ok"
    assert set(result["documents"]) == {
        "https://example.com/dce.pdf",
        "https://example.com/dce.pdf?download=1",
        "https://example.com/plan.xlsx",
    }
    assert result["page_title"] == "Notice"


def test_handle_find_documents_missing_url():
    from smart_ziw_research import handle_find_documents

    result = asyncio.run(handle_find_documents({}))
    assert result["status"] == "error"
    assert "source_url" in result["error"]


def test_handle_download_document_ok(monkeypatch, tmp_path):
    class StubStore:
        def __init__(self, folder_path, config=None):
            self.folder_path = folder_path

        def download(self, url, title=""):
            path = self.folder_path / "files" / "original" / "dce.pdf"
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b"%PDF fake")
            return path, None

        def save_extraction(self, path):
            return path.with_suffix(".md"), True

    monkeypatch.setattr("database.get_project_by_db_id", lambda tid: dict(PROJECT))
    monkeypatch.setattr(
        "smart_ziw_config.load_smart_ziw_config",
        lambda: {"smart_ziw_repo_path": str(tmp_path)},
    )
    monkeypatch.setattr("smart_ziw_research.DocumentStore", StubStore)
    from smart_ziw_research import handle_download_document

    result = asyncio.run(handle_download_document({
        "url": "https://example.com/dce.pdf",
        "tender_id": "507f1f77bcf86cd799439011",
    }))
    assert result["status"] == "ok"
    assert result["file"].endswith("dce.pdf")
    assert result["markdown_path"].endswith("dce.md")
    assert result["extracted"] is True


def test_handle_download_document_missing_args():
    from smart_ziw_research import handle_download_document

    result = asyncio.run(handle_download_document({"url": "https://x.com/d.pdf"}))
    assert result["status"] == "error"
    assert "url and tender_id" in result["error"]


def test_tools_registry_research_handlers_return_status_dicts(monkeypatch):
    """Wire-through: every Task-5 registered tool, called through smart_ziw_tools,
    returns a status dict instead of raising, with all backends failing."""
    monkeypatch.setattr("smart_ziw_config.load_smart_ziw_config", lambda: {})
    monkeypatch.setattr("database.get_project_by_db_id", lambda tid: None)

    class BoomClient:
        def __init__(self, config):
            self.config = config

        def scrape(self, url):
            return {"_error": "no"}

    monkeypatch.setattr("smart_ziw_research.FirecrawlClient", BoomClient)

    def _explode(*a, **k):
        raise AssertionError("network should not be used")

    monkeypatch.setattr("smart_ziw_research.requests.get", _explode)
    from smart_ziw_tools import REGISTRY

    cases = {
        "derive_buyer_site": {"tender_id": "missing"},
        "brave_web_search": {"query": "q"},
        "scrape_page": {"url": "https://example.com"},
        "find_documents": {"source_url": "https://example.com"},
        "download_document": {"url": "https://example.com/d.pdf", "tender_id": "missing"},
    }
    for name, args in cases.items():
        result = asyncio.run(REGISTRY[name].handler(args))
        assert result["status"] in ("ok", "error"), name
        if result["status"] == "error":
            assert "error" in result, name

