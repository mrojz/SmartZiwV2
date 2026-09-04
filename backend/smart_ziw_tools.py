"""Tool schemas for the Smart-Ziw tool-loop."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Awaitable


@dataclass(frozen=True)
class Tool:
    name: str
    description: str
    input_schema: dict[str, Any]
    handler: Callable[[dict[str, Any]], Awaitable[dict[str, Any]]]


REGISTRY: dict[str, Tool] = {}


def register(name: str, description: str, input_schema: dict[str, Any]):
    def decorator(handler: Callable[[dict[str, Any]], Awaitable[dict[str, Any]]]) -> Tool:
        tool = Tool(name=name, description=description, input_schema=input_schema, handler=handler)
        REGISTRY[name] = tool
        return tool
    return decorator


def get_tool(name: str) -> Tool:
    return REGISTRY[name]


def list_tools() -> list[Tool]:
    return list(REGISTRY.values())


FETCH_AGGREGATOR_TENDER_SCHEMA = {
    "type": "object",
    "properties": {"tender_id": {"type": "string"}},
    "required": ["tender_id"],
}

DERIVE_BUYER_SITE_SCHEMA = {
    "type": "object",
    "properties": {"tender_id": {"type": "string"}},
    "required": ["tender_id"],
}

BRAVE_WEB_SEARCH_SCHEMA = {
    "type": "object",
    "properties": {
        "query": {"type": "string"},
        "count": {"type": "integer", "default": 10},
    },
    "required": ["query"],
}

SCRAPE_PAGE_SCHEMA = {
    "type": "object",
    "properties": {"url": {"type": "string"}},
    "required": ["url"],
}

FIND_DOCUMENTS_SCHEMA = {
    "type": "object",
    "properties": {
        "source_url": {"type": "string"},
        "tender_title": {"type": "string"},
        "tender_reference": {"type": "string"},
    },
    "required": ["source_url"],
}

DOWNLOAD_DOCUMENT_SCHEMA = {
    "type": "object",
    "properties": {
        "url": {"type": "string"},
        "tender_id": {"type": "string"},
    },
    "required": ["url", "tender_id"],
}

POST_COMMENT_SCHEMA = {
    "type": "object",
    "properties": {
        "tender_id": {"type": "string"},
        "content": {"type": "string"},
        "source_url": {"type": "string"},
        "downloaded_files": {"type": "array", "items": {"type": "string"}, "default": []},
        "failed_files": {"type": "array", "items": {"type": "string"}, "default": []},
    },
    "required": ["tender_id", "content", "source_url"],
}


@register("fetch_aggregator_tender", "Fetch tender details from the aggregator site.", FETCH_AGGREGATOR_TENDER_SCHEMA)
async def fetch_aggregator_tender(args: dict[str, Any]) -> dict[str, Any]:
    from smart_ziw_research import handle_fetch_aggregator_tender
    return await handle_fetch_aggregator_tender(args)


@register("derive_buyer_site", "Guess the buyer's official site from tender emails.", DERIVE_BUYER_SITE_SCHEMA)
async def derive_buyer_site(args: dict[str, Any]) -> dict[str, Any]:
    from smart_ziw_research import handle_derive_buyer_site
    return await handle_derive_buyer_site(args)


@register("brave_web_search", "Search the web using Brave Search API.", BRAVE_WEB_SEARCH_SCHEMA)
async def brave_web_search(args: dict[str, Any]) -> dict[str, Any]:
    from smart_ziw_research import handle_brave_web_search
    return await handle_brave_web_search(args)


@register("scrape_page", "Scrape a web page and extract text and links.", SCRAPE_PAGE_SCHEMA)
async def scrape_page(args: dict[str, Any]) -> dict[str, Any]:
    from smart_ziw_research import handle_scrape_page
    return await handle_scrape_page(args)


@register("find_documents", "Find downloadable documents on a source page or via search.", FIND_DOCUMENTS_SCHEMA)
async def find_documents(args: dict[str, Any]) -> dict[str, Any]:
    from smart_ziw_research import handle_find_documents
    return await handle_find_documents(args)


@register("download_document", "Download a document and convert to markdown.", DOWNLOAD_DOCUMENT_SCHEMA)
async def download_document(args: dict[str, Any]) -> dict[str, Any]:
    from smart_ziw_research import handle_download_document
    return await handle_download_document(args)


@register("post_smart_ziw_comment", "Post the final Smart-Ziw analysis comment.", POST_COMMENT_SCHEMA)
async def post_smart_ziw_comment(args: dict[str, Any]) -> dict[str, Any]:
    raise NotImplementedError
