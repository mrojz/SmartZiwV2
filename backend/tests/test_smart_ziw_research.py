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


def test_search_without_mcp_server_returns_config_error(monkeypatch):
    monkeypatch.setattr("smart_ziw_research._find_firecrawl_mcp_server", lambda: None)
    client = FirecrawlClient({})
    rows = client.search("q")
    assert len(rows) == 1 and "_error" in rows[0]
    assert "MCP Servers tab" in rows[0]["_error"]


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
    assert path.parent == tmp_path / "documents" / "original"


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
    assert (tmp_path / "folder" / "artifacts" / "research-log.md").exists()


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
    assert (tmp_path / "folder" / "artifacts" / "page-1.md").exists()
    assert (tmp_path / "folder" / "documents" / "original" / "dce.pdf").exists()
    assert (tmp_path / "folder" / "documents" / "extracted" / "dce.md").exists()


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


def test_run_research_no_mcp_server_returns_error(monkeypatch, tmp_path):
    counters = {"seed": 0, "select": 0, "round": 0, "verdict": 0}

    def call(system, user):
        counters["seed"] += 1
        return {}

    monkeypatch.setattr("smart_ziw_research._find_firecrawl_mcp_server", lambda: None)
    result = run_research(PROJECT, {"smart_ziw_repo_path": "/tmp/x"}, folder_path=tmp_path / "f", llm_call=call)
    assert "No Firecrawl MCP server configured" in result.error
    assert counters["seed"] == 0


from smart_ziw_research import (
    SUMMARIZE_PROMPT,
    SYNTHESIS_PROMPT,
    CorpusItem,
    ResearchResult,
    synthesize,
)

SYNTH_FULL = {
    "source_markdown": "# Source\n\nVerified [1]",
    "analysis_markdown": "# Analysis\n\nGO [1]",
    "eligibility_markdown": "# Eligibility\n\nok",
    "risks_markdown": "# Risks\n\nlow",
    "pricing_markdown": "# Pricing\n\nUSD 1000",
    "recap_markdown": "# Tender Recap\n\nGO",
    "readme_markdown": "# README\n\nfolder",
    "documents_notes_markdown": "# Documents\n\nnone",
}


def _make_research(num_items: int) -> ResearchResult:
    corpus = EvidenceCorpus()
    for index in range(num_items):
        corpus.add("page", f"https://example.com/p{index}", f"P{index}", f"content {index}")
    return ResearchResult(items=corpus.items, citation_map=corpus.citation_map())


def test_synthesize_chunks_and_returns_coerced_dict():
    research = _make_research(10)  # 2 chunks of 8
    calls = {"summarize": 0, "final": 0}

    def call(system, user):
        if system == SUMMARIZE_PROMPT:
            calls["summarize"] += 1
            return {"summaries": [{"citation": 1, "summary": "s"}]}
        if system == SYNTHESIS_PROMPT:
            calls["final"] += 1
            return SYNTH_FULL
        raise AssertionError(f"unexpected prompt: {system[:60]}")

    result = synthesize(PROJECT, research, llm_call=call)
    assert calls["summarize"] == 2
    assert calls["final"] == 1
    assert result["source_markdown"] == "# Source\n\nVerified [1]"
    assert result["analysis_markdown"] == "# Analysis\n\nGO [1]"
    assert result["pricing_markdown"] == "# Pricing\n\nUSD 1000"


def test_synthesize_coerces_bad_fields_to_safe_defaults():
    research = _make_research(0)

    def call(system, user):
        if system == SUMMARIZE_PROMPT:
            raise AssertionError("no chunks expected")
        if system == SYNTHESIS_PROMPT:
            return {"analysis_markdown": "bad", "source_markdown": ""}
        raise AssertionError(f"unexpected prompt: {system[:60]}")

    result = synthesize(PROJECT, research, llm_call=call)
    assert "# Source" in result["source_markdown"]
    assert "# Analysis" in result["analysis_markdown"]
    assert "GO-CONDITIONAL" in result["recap_markdown"]
    assert "# Eligibility" in result["eligibility_markdown"]


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


def test_run_research_none_timeout_still_returns_config_error(monkeypatch, tmp_path):
    # I3: timeout coercion must not raise when the config value is None.
    counters = {"seed": 0, "select": 0, "round": 0, "verdict": 0}

    def call(system, user):
        counters["seed"] += 1
        return {}

    monkeypatch.setattr("smart_ziw_research._find_firecrawl_mcp_server", lambda: None)
    result = run_research(
        PROJECT,
        {"smart_ziw_research_timeout_seconds": None},
        folder_path=tmp_path / "f",
        llm_call=call,
    )
    assert "No Firecrawl MCP server configured" in result.error
    assert counters["seed"] == 0


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
    log = tmp_path / "folder" / "artifacts" / "research-log.md"
    assert log.exists()
    assert "Notice" in log.read_text(encoding="utf-8")


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


def test_document_store_writes_notes_md(tmp_path, monkeypatch):
    monkeypatch.setattr("smart_ziw_research.socket.getaddrinfo", _public_dns)
    monkeypatch.setattr("smart_ziw_research.requests.get", lambda *a, **k: _fake_get())
    store = DocumentStore(tmp_path)
    path, _ = store.download("https://example.com/file.PDF")
    store.save_extraction(path)
    store.write_notes(PROJECT)
    notes = (tmp_path / "documents" / "notes.md").read_text(encoding="utf-8")
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

