"""
AI Enrichment Pipeline — runs AFTER scraping + AI verification.

Two DeepSeek requests per project:
1. Research  — AI finds original source + document URLs (Google dorking, known portals)
2. Analysis  — AI analyzes downloaded document text

Only processes new AI-verified projects.
"""

import json
import os
import re
import sys
import time
import random
import hashlib
from pathlib import Path

import requests as req
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv(override=False)


# ── Configuration ────────────────────────────────────────────────────────────

DEEPSEEK_API_KEY = os.environ.get("DEEPSEEK_API_KEY", "")
DEEPSEEK_BASE_URL = os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
DEEPSEEK_MODEL = "deepseek-chat"

MAX_TEXT_CHARS = 15000     # Max chars of document text sent to AI
MAX_RETRIES = 3
MAX_DOCS_PER_PROJECT = 5
MAX_FILE_SIZE_MB = 20
DOWNLOAD_DIR = Path(__file__).resolve().parent / "downloads"

REQUEST_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

DOC_EXTENSIONS = {".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx"}


# ── Helpers ──────────────────────────────────────────────────────────────────


def _safe_log(message: str = ""):
    text = str(message)
    stream = getattr(sys, "stdout", None) or getattr(sys, "__stdout__", None)
    if stream is None:
        return
    try:
        stream.write(text + "\n")
        stream.flush()
    except UnicodeEncodeError:
        encoding = getattr(stream, "encoding", None) or "utf-8"
        safe = (text + "\n").encode(encoding, "replace").decode(encoding, "replace")
        try:
            stream.write(safe)
            stream.flush()
        except Exception:
            pass


def _deepseek_request(client, system_prompt: str, user_prompt: str,
                      max_tokens: int = 4000, temperature: float = 0.0,
                      label: str = "") -> str | None:
    """Send a request to DeepSeek and return the raw text content."""
    tag = f"[{label}] " if label else ""

    print(f"\n      {tag}─── PROMPT TO DEEPSEEK ───")
    _safe_log(f"      {tag}System: {system_prompt[:200]}...")
    _safe_log(f"      {tag}User:")
    for line in user_prompt.split("\n"):
        _safe_log(f"      {tag}  {line}")
    print(f"      {tag}──────────────────────────")

    for attempt in range(MAX_RETRIES):
        try:
            time.sleep(random.uniform(0.2, 0.8))
            response = client.chat.completions.create(
                model=DEEPSEEK_MODEL,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=temperature,
                max_tokens=max_tokens,
            )
            content = response.choices[0].message.content.strip()

            print(f"\n      {tag}─── AI RESPONSE ───")
            for line in content.split("\n"):
                _safe_log(f"      {tag}  {line}")
            print(f"      {tag}────────────────────")

            return content

        except Exception as e:
            _safe_log(f"      {tag}[!] DeepSeek API error (attempt {attempt + 1}): {e}")
            if attempt < MAX_RETRIES - 1:
                wait = (2 ** attempt) + random.uniform(1, 3)
                time.sleep(wait)

    return None


def _parse_json_response(text: str) -> dict | list | None:
    """Parse JSON from DeepSeek response, handling markdown code blocks."""
    if not text:
        return None

    content = text.strip()

    # Handle markdown code blocks
    if content.startswith("```"):
        content = content.split("```")[1]
        if content.startswith("json"):
            content = content[4:]
        content = content.strip()

    try:
        return json.loads(content)
    except json.JSONDecodeError:
        # Try to find JSON object/array in the response
        for pattern in [r'\{[\s\S]*\}', r'\[[\s\S]*\]']:
            match = re.search(pattern, content)
            if match:
                try:
                    return json.loads(match.group())
                except json.JSONDecodeError:
                    continue
        return None


def _safe_filename(name: str, max_len: int = 80) -> str:
    """Sanitize a string for use as a filename."""
    name = re.sub(r'[<>:"/\\|?*]', "_", name)
    name = re.sub(r"\s+", "_", name).strip("_")
    return name[:max_len] if name else "document"


def _download_file(url: str, dest_dir: Path, session: req.Session) -> dict | None:
    """Download a file from a URL. Returns metadata dict or None on failure."""
    try:
        resp = session.get(url, headers=REQUEST_HEADERS, timeout=30, stream=True,
                           allow_redirects=True)
        resp.raise_for_status()

        # Determine filename
        cd = resp.headers.get("Content-Disposition", "")
        if "filename=" in cd:
            filename = cd.split("filename=")[-1].strip('"').strip("'")
        else:
            filename = os.path.basename(url.split("?")[0]) or "document"

        filename = _safe_filename(filename)

        # Ensure it has an extension
        if not any(filename.lower().endswith(ext) for ext in DOC_EXTENSIONS):
            ct = resp.headers.get("Content-Type", "").lower()
            if "pdf" in ct:
                filename += ".pdf"
            elif "word" in ct or "docx" in ct:
                filename += ".docx"
            elif "excel" in ct or "spreadsheet" in ct:
                filename += ".xlsx"

        # Check size
        cl = resp.headers.get("Content-Length")
        if cl and int(cl) > MAX_FILE_SIZE_MB * 1024 * 1024:
            print(f"      [!] Skipping {filename}: too large ({int(cl) // 1024 // 1024}MB)")
            return None

        dest_dir.mkdir(parents=True, exist_ok=True)
        filepath = dest_dir / filename

        if filepath.exists():
            return {
                "filename": filename,
                "path": str(filepath),
                "url": url,
                "size": filepath.stat().st_size,
            }

        total = 0
        with open(filepath, "wb") as f:
            for chunk in resp.iter_content(chunk_size=8192):
                total += len(chunk)
                if total > MAX_FILE_SIZE_MB * 1024 * 1024:
                    f.close()
                    filepath.unlink(missing_ok=True)
                    print(f"      [!] Aborted {filename}: exceeded {MAX_FILE_SIZE_MB}MB")
                    return None
                f.write(chunk)

        return {
            "filename": filename,
            "path": str(filepath),
            "url": url,
            "size": total,
        }

    except Exception as e:
        print(f"      [!] Download failed ({url[:80]}): {e}")
        return None


# ── STAGE 1: DOWNLOAD DOCUMENTS ─────────────────────────────────────────────


def download_documents(projects):
    """Stage 2: Download documents from URLs that DeepSeek found.

    Modifies projects in-place, adding:
    - 'documents' (list of metadata dicts for DB)
    - '_doc_paths' (list of local file paths — temporary, for analysis)
    """
    projects_with_urls = [p for p in projects if p.get("_document_urls")]
    if not projects_with_urls:
        print("\n[i] No document URLs to download")
        return

    print("\n" + "=" * 60)
    print("  Document Download")
    print("=" * 60)
    print(f"  Projects with document URLs: {len(projects_with_urls)}")

    session = req.Session()
    total_downloaded = 0

    for i, project in enumerate(projects_with_urls, 1):
        title = (project.get("project_description", "") or project.get("project_name", ""))[:60]
        print(f"\n  [{i}/{len(projects_with_urls)}] {title}")

        project_id = project.get("project_id", "") or hashlib.md5(
            project.get("project_name", "").encode()
        ).hexdigest()[:12]
        dest_dir = DOWNLOAD_DIR / _safe_filename(str(project_id))

        downloaded = []
        doc_paths = []

        for doc_info in project.get("_document_urls", []):
            url = doc_info.get("url", "")
            doc_title = doc_info.get("title", "")

            if not url:
                continue

            print(f"      📥 {doc_title or url[:60]}...")
            result = _download_file(url, dest_dir, session)

            if result:
                result["title"] = doc_title
                ext = Path(result["filename"]).suffix.lower()
                result["extension"] = ext
                downloaded.append(result)
                doc_paths.append(result["path"])
                print(f"         ✅ Downloaded: {result['filename']}")
            else:
                print(f"         — Failed or skipped")

            time.sleep(0.3)

        project["documents"] = [
            {
                "filename": d["filename"],
                "url": d["url"],
                "size": d["size"],
                "title": d.get("title", ""),
                "extension": d.get("extension", ""),
            }
            for d in downloaded
        ]
        project["_doc_paths"] = doc_paths
        total_downloaded += len(downloaded)

        if downloaded:
            print(f"      📎 {len(downloaded)} document(s) downloaded")
        else:
            print(f"      — No documents downloaded")

    print(f"\n[+] Download complete: {total_downloaded} documents from {len(projects_with_urls)} projects")


# ── STAGE 3: DOCUMENT ANALYSIS ──────────────────────────────────────────────

DOC_ANALYSIS_PROMPT = """You are a procurement document analyst. You will receive the text content of a procurement document (PDF or Word).

Analyze it and extract the following in a structured JSON format:
{
    "summary": "2-3 sentence summary of what the project is about",
    "requirements": ["list of key technical/functional requirements"],
    "phases": ["list of project phases/timeline milestones if mentioned"],
    "deliverables": ["list of expected deliverables"],
    "budget": "budget amount and currency if mentioned, or null",
    "eligibility": "eligibility criteria for bidders if mentioned, or null",
    "evaluation_criteria": ["list of evaluation criteria if mentioned"],
    "key_dates": {"submission_deadline": "date if found", "project_start": "date if found", "project_end": "date if found"},
    "skills_required": ["specific skills or certifications required"]
}

Focus on actionable information. Omit empty arrays or null fields.
Return ONLY the JSON object, no explanation."""


def _extract_text_from_pdf(filepath: str) -> str:
    """Extract text from a PDF file using pdfplumber."""
    try:
        import pdfplumber
        text_parts = []
        with pdfplumber.open(filepath) as pdf:
            for page in pdf.pages[:50]:  # Up to 50 pages
                page_text = page.extract_text()
                if page_text:
                    text_parts.append(page_text)
                if len("\n".join(text_parts)) > MAX_TEXT_CHARS:
                    break
        return "\n".join(text_parts)[:MAX_TEXT_CHARS]
    except Exception as e:
        print(f"      [!] PDF extraction failed: {e}")
        return ""


def _extract_text_from_docx(filepath: str) -> str:
    """Extract text from a Word (.docx) document."""
    try:
        from docx import Document
        doc = Document(filepath)
        text_parts = []
        for para in doc.paragraphs:
            text_parts.append(para.text)
            if len("\n".join(text_parts)) > MAX_TEXT_CHARS:
                break
        return "\n".join(text_parts)[:MAX_TEXT_CHARS]
    except Exception as e:
        print(f"      [!] DOCX extraction failed: {e}")
        return ""


def _extract_text(filepath: str) -> str:
    """Extract text from a document based on its extension."""
    path = Path(filepath)
    ext = path.suffix.lower()

    if ext == ".pdf":
        return _extract_text_from_pdf(filepath)
    elif ext in (".docx", ".doc"):
        return _extract_text_from_docx(filepath)
    else:
        return ""


def analyze_documents(projects):
    """Stage 3: Analyze downloaded documents using DeepSeek AI.

    Modifies projects in-place, adding 'doc_analysis' field.
    """
    projects_with_docs = [p for p in projects if p.get("_doc_paths")]
    if not projects_with_docs:
        print("\n[i] No documents to analyze")
        return

    print("\n" + "=" * 60)
    print("  AI Document Analysis (DeepSeek)")
    print("=" * 60)
    print(f"  Projects with documents: {len(projects_with_docs)}")

    client = OpenAI(api_key=DEEPSEEK_API_KEY, base_url=DEEPSEEK_BASE_URL)

    analyzed = 0
    for i, project in enumerate(projects_with_docs, 1):
        title = (project.get("project_description", "") or project.get("project_name", ""))[:60]
        print(f"\n  [{i}/{len(projects_with_docs)}] {title}")

        all_analyses = []
        for doc_path in project.get("_doc_paths", []):
            doc_name = Path(doc_path).name
            print(f"      📄 Analyzing: {doc_name}...")

            text = _extract_text(doc_path)
            if not text or len(text.strip()) < 100:
                print(f"      — Insufficient text extracted, skipping")
                continue

            # Log extracted text preview
            preview = text[:300].replace("\n", " ")
            print(f"      📝 Extracted text preview: {preview}...")

            user_prompt = f"Document title: {doc_name}\n\n---\n\n{text}"
            content = _deepseek_request(client, DOC_ANALYSIS_PROMPT, user_prompt,
                                        label="DocAnalysis")
            analysis = _parse_json_response(content)

            if analysis:
                analysis["document"] = doc_name
                all_analyses.append(analysis)
                print(f"      ✅ Analysis complete")

                # Log parsed analysis summary
                if analysis.get("summary"):
                    print(f"         Summary: {analysis['summary'][:150]}...")
                if analysis.get("requirements"):
                    print(f"         Requirements: {len(analysis['requirements'])} items")
                if analysis.get("budget"):
                    print(f"         Budget: {analysis['budget']}")
            else:
                print(f"      ❌ Analysis failed")

        if all_analyses:
            if len(all_analyses) == 1:
                project["doc_analysis"] = all_analyses[0]
            else:
                project["doc_analysis"] = {
                    "documents_analyzed": len(all_analyses),
                    "analyses": all_analyses,
                }
            analyzed += 1

        # Clean up temporary fields
        project.pop("_doc_paths", None)
        project.pop("_document_urls", None)
        project.pop("_search_queries", None)

    # Also clean up for projects without docs
    for p in projects:
        p.pop("_doc_paths", None)
        p.pop("_document_urls", None)
        p.pop("_search_queries", None)

    print(f"\n[+] Document analysis complete: {analyzed}/{len(projects_with_docs)} projects analyzed")


# ── MAIN PIPELINE ────────────────────────────────────────────────────────────


def run_enrichment(projects, skip_download=False, skip_analysis=False):
    """Run the enrichment pipeline on a list of projects.

    This should be called AFTER AI verification, with only verified projects.
    Modifies projects in-place.
    """
    if not projects:
        print("[i] No projects to enrich")
        return

    print("\n" + "#" * 60)
    print("  AI ENRICHMENT PIPELINE")
    print("#" * 60)
    print(f"  Projects: {len(projects)}")

    # Stage 1: Download documents
    if not skip_download:
        download_documents(projects)

    # Stage 2: Analyze downloaded documents
    if not skip_download and not skip_analysis:
        analyze_documents(projects)

    print("\n" + "#" * 60)
    print("  ENRICHMENT PIPELINE COMPLETE")
    print("#" * 60)
