import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from smart_ziw_tools import REGISTRY


def test_registry_has_required_tools():
    required = {
        "fetch_aggregator_tender",
        "derive_buyer_site",
        "brave_web_search",
        "scrape_page",
        "find_documents",
        "download_document",
        "post_smart_ziw_comment",
    }
    assert required <= set(REGISTRY.keys())
    for name in required:
        assert REGISTRY[name].input_schema.get("type") == "object"
