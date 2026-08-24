"""Skill that downloads tender documents and extracts their text."""
from __future__ import annotations

from pathlib import Path

from smart_ziw_skills.base import Skill


def _download_documents(urls: list[str] | None = None, **context) -> dict:
    from smart_ziw_research import DocumentStore

    project = context.get("project") or {}
    config = context.get("config") or {}
    folder_path = context.get("folder_path")
    if folder_path is None:
        return {"downloaded": 0, "extracted": 0, "notes": "", "error": "folder_path not provided"}

    store = DocumentStore(Path(folder_path), config=config)
    target_urls = list(urls or [])
    if not target_urls:
        project_url = project.get("project_url") or ""
        if project_url:
            target_urls.append(project_url)

    downloaded = 0
    extracted = 0
    error = ""
    for url in target_urls:
        try:
            doc_path, doc_error = store.download(url, title=project.get("project_name") or "")
            if doc_error:
                error = error or doc_error
                continue
            downloaded += 1
            if doc_path:
                try:
                    _, ok = store.save_extraction(doc_path)
                    if ok:
                        extracted += 1
                except Exception as exc:
                    error = error or str(exc)
        except Exception as exc:
            error = error or str(exc)

    try:
        store.write_notes(project)
    except Exception as exc:
        error = error or str(exc)

    return {
        "downloaded": downloaded,
        "extracted": extracted,
        "notes": store.notes,
        "error": error,
    }


documents_skill = Skill(
    id="download_documents",
    name="Download documents",
    description="Download tender document URLs, extract text, and write notes.md.",
    parameters={
        "type": "object",
        "properties": {
            "urls": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Optional list of document URLs to download; defaults to the project URL.",
            },
        },
    },
    handler=_download_documents,
)
