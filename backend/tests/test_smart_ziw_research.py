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


from smart_ziw_research import DocumentStore, is_document_url


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
