"""
OAS Procureware scraper.

Bootstraps a public Procureware session from /Bids, then searches the grid
endpoint with each configured keyword and returns deduplicated active notices.
"""

from __future__ import annotations

import json
import re
import time
from datetime import datetime, timezone

import requests
from bs4 import BeautifulSoup

from shared_excel import get_search_keywords


BASE_URL = "https://oas.procureware.com"
BIDS_URL = f"{BASE_URL}/Bids"
GRID_URL = f"{BASE_URL}/domain/Generic/Grid"
PAGE_SIZE = 50
ACTIVE_STATUSES = {"active", "amended", "open"}
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36"
    ),
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Origin": BASE_URL,
    "Referer": BIDS_URL,
    "X-Requested-With": "XMLHttpRequest",
}


def _normalize_space(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "")).strip()


def _parse_iso_date(value: str) -> str:
    text = _normalize_space(value)
    if not text:
        return ""
    for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M:%S.%f", "%Y-%m-%d"):
        try:
            return datetime.strptime(text, fmt).strftime("%m/%d/%Y")
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).strftime("%m/%d/%Y")
    except ValueError:
        return ""


def _is_active_notice(item: dict) -> bool:
    status = _normalize_space(item.get("FullBidView_CalculatedAdjustedStatusMeaning", "")).lower()
    if status in ACTIVE_STATUSES:
        return True

    due_raw = item.get("FullBidView_DueDate", "")
    if not due_raw:
        return False
    try:
        due_dt = datetime.fromisoformat(str(due_raw).replace("Z", "+00:00"))
        return due_dt >= datetime.now(timezone.utc).replace(tzinfo=due_dt.tzinfo)
    except Exception:
        return False


def _build_session() -> requests.Session:
    session = requests.Session()
    session.headers.update(HEADERS)
    return session


def _bootstrap_session(session: requests.Session) -> str:
    response = session.get(BIDS_URL, timeout=30)
    response.raise_for_status()
    soup = BeautifulSoup(response.text, "html.parser")
    token_input = soup.find("input", {"name": "__RequestVerificationToken"})
    token = (token_input.get("value", "") if token_input else "").strip()
    if not token:
        raise RuntimeError("OAS anti-forgery token not found")
    return token


def _build_grid_payload(page: int, keyword: str | None = None) -> dict[str, str]:
    payload = {
        "mode": "",
        "id": "",
        "viewModelName": "",
        "primId": "",
        "parentEntityId": "",
        "parentEntityName": "",
        "baseEntityId": "",
        "baseEntityName": "",
        "fkGrandparentId": "",
        "EntityGuid": "",
        "hex": "",
        "hex2": "",
        "view": "bid_layout_first_view",
        "treeId": "",
        "FieldSetters": "",
        "excludeIds": "",
        "deactivatedIds": "",
        "selectedIds": "",
        "grid": "bid_grid",
        "CurrMenu": "Bids",
        "settings[Page]": str(page),
        "settings[PageSize]": str(PAGE_SIZE),
        "CurrUser": "0",
        "dom": "1",
    }
    if keyword:
        payload["settings[Filters][0][Field]"] = "Title"
        payload["settings[Filters][0][UniqueName]"] = "Bid.Title"
        payload["settings[Filters][0][Operator]"] = "1"
        payload["settings[Filters][0][Value]"] = keyword
        payload["settings[Filters][0][DisplayValue]"] = keyword
    return payload


def _post_grid(session: requests.Session, token: str, payload: dict[str, str]) -> dict:
    headers = {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "RequestVerificationToken": token,
    }
    for attempt in range(3):
        try:
            response = session.post(GRID_URL, headers=headers, data=payload, timeout=30)
            response.raise_for_status()
            data = response.json()
            if data.get("StatusCode") != 1:
                raise RuntimeError(f"OAS grid error: {data.get('Message') or data.get('SubStatus') or 'unknown'}")
            message = data.get("Message") or "{}"
            return json.loads(message)
        except Exception as exc:
            if attempt == 2:
                raise
            wait = 1.5 * (attempt + 1)
            print(f"    [!] OAS grid request retry in {wait:.1f}s: {exc}", flush=True)
            time.sleep(wait)
    return {}


def _item_to_project(item: dict, keyword: str) -> dict:
    bid_id = item.get("FullBidView_Id", "")
    guid = item.get("FullBidView_GuidId", "")
    title = _normalize_space(item.get("FullBidView_Title", ""))
    number = _normalize_space(item.get("FullBidView_Number", ""))
    bid_type = _normalize_space(item.get("FullBidView_BidTypeName", ""))
    contact = _normalize_space(item.get("FullBidView_ContactInformation", ""))
    status = _normalize_space(item.get("FullBidView_CalculatedAdjustedStatusMeaning", ""))
    if not status:
        status_map = {1: "Active", 2: "Open", 3: "Cancelled", 4: "Closed"}
        status = status_map.get(item.get("FullBidView_CalculatedAdjustedStatus"), "")

    description_parts = [title]
    if number:
        description_parts.append(f"Reference: {number}")
    if bid_type:
        description_parts.append(f"Type: {bid_type}")
    if status:
        description_parts.append(f"Status: {status}")
    if contact:
        description_parts.append(f"Contact: {contact}")

    detail_url = f"{BIDS_URL}#bid-{guid}" if guid else BIDS_URL

    return {
        "project_id": f"OAS-{bid_id}",
        "project_name": title,
        "project_start_date": _parse_iso_date(item.get("FullBidView_AvailableDate", "")),
        "project_end_date": _parse_iso_date(item.get("FullBidView_DueDate", "")),
        "project_description": " | ".join(part for part in description_parts if part),
        "project_sponsor": "OAS",
        "source": "OAS",
        "document_url": "",
        "project_url": detail_url,
        "matched_keywords": keyword,
        "ai_verified": "",
        "decision": "",
        "notice_status": status,
    }


def _search_keyword(session: requests.Session, token: str, keyword: str) -> list[dict]:
    all_projects: list[dict] = []
    page = 1
    total_count = None

    while True:
        payload = _build_grid_payload(page, keyword)
        data = _post_grid(session, token, payload)
        items = data.get("Data", []) or []
        total_count = int(data.get("TotalCount", len(items)) or 0)

        active_items = [item for item in items if _is_active_notice(item)]
        all_projects.extend(_item_to_project(item, keyword) for item in active_items)

        if (page * PAGE_SIZE) >= total_count or not items:
            break
        page += 1
        time.sleep(0.4)

    return all_projects


def run_oas_scraper() -> list[dict]:
    print("\n" + "=" * 60, flush=True)
    print("  OAS Procureware Scraper", flush=True)
    print("=" * 60, flush=True)

    session = _build_session()
    token = _bootstrap_session(session)
    keywords = get_search_keywords()

    seen: dict[tuple[str, str], dict] = {}
    total_raw = 0

    for idx, keyword in enumerate(keywords, 1):
        print(f"\n[{idx}/{len(keywords)}] Searching OAS: '{keyword}'", flush=True)
        projects = _search_keyword(session, token, keyword)
        print(f"    Found {len(projects)} active notices", flush=True)
        total_raw += len(projects)

        for project in projects:
            dedup_key = (project["project_id"], project["project_name"])
            if dedup_key in seen:
                existing = seen[dedup_key]
                keyword_list = [value for value in existing.get("matched_keywords", "").split(", ") if value]
                if keyword not in keyword_list:
                    keyword_list.append(keyword)
                    existing["matched_keywords"] = ", ".join(keyword_list)
            else:
                seen[dedup_key] = project

        if idx < len(keywords):
            time.sleep(0.8)

    all_projects = list(seen.values())
    print(f"\n[+] Total raw OAS notices: {total_raw}", flush=True)
    print(f"[+] Unique OAS notices after dedup: {len(all_projects)}", flush=True)
    return all_projects
