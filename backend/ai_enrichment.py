"""
AI Enrichment Pipeline — runs AFTER scraping + AI verification.

Three stages:
1. Source Detection  — DeepSeek identifies the original funding source
2. Document Scraping — detail pages visited, docs downloaded
3. Document Analysis — PDFs/Word docs summarized by DeepSeek

Only processes new AI-verified projects. Threaded for speed.
"""

import json
import os
import time
import random
import threading
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()


# ── Configuration ────────────────────────────────────────────────────────────

DEEPSEEK_API_KEY = os.environ.get("DEEPSEEK_API_KEY", "")
DEEPSEEK_BASE_URL = os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
DEEPSEEK_MODEL = "deepseek-chat"

BATCH_SIZE = 5
MAX_WORKERS = 4
MAX_TEXT_CHARS = 8000      # Max chars of document text sent to AI
MAX_RETRIES = 3


# ── 1. SOURCE DETECTION ─────────────────────────────────────────────────────

SOURCE_PROMPT = """You are a procurement intelligence analyst. You analyze tender/project notices scraped from aggregator websites.

Your task: identify the ORIGINAL funding source or donor organization for each project. Aggregator sites (like DGMarket, Global Tenders, DevelopmentAid) just list tenders — the actual source is the funding organization.

Common sources include:
- World Bank, African Development Bank (AfDB), Asian Development Bank (ADB)
- European Union (EU), EuropeAid, European Commission
- UNDP, UNICEF, UN agencies
- USAID, GIZ, JICA, AFD, DFID/FCDO, SIDA
- National governments, ministries
- If the source IS the original (e.g., "World Bank" project from World Bank scraper), return the same source.
- If you cannot determine the source, return "Unknown"

You will receive a numbered list of projects with their metadata.
Respond ONLY with a JSON array:
[{"id": 1, "source": "African Development Bank"}, {"id": 2, "source": "EU"}, ...]

No explanation, just the JSON array."""


def _build_source_prompt(projects_batch, start_idx):
    """Build a numbered list for source detection."""
    lines = []
    for i, p in enumerate(projects_batch):
        idx = start_idx + i + 1
        title = p.get("project_description", "") or p.get("project_name", "")
        name = p.get("project_name", "")
        sponsor = p.get("project_sponsor", "")
        source = p.get("source", "")
        donor = p.get("donor", "")
        lines.append(
            f"{idx}. [Aggregator: {source}] [Country: {sponsor}] "
            f"[Donor/Authority: {donor}] Title: {title} | Project: {name}"
        )
    return "\n".join(lines)


def _detect_source_batch(client, projects_batch, start_idx):
    """Send a batch to DeepSeek for source detection. Returns list of source strings."""
    prompt = _build_source_prompt(projects_batch, start_idx)
    batch_size = len(projects_batch)

    for attempt in range(MAX_RETRIES):
        try:
            time.sleep(random.uniform(0.1, 0.5))

            response = client.chat.completions.create(
                model=DEEPSEEK_MODEL,
                messages=[
                    {"role": "system", "content": SOURCE_PROMPT},
                    {"role": "user", "content": prompt},
                ],
                temperature=0.0,
                max_tokens=2000,
            )

            content = response.choices[0].message.content.strip()

            # Handle markdown code blocks
            if content.startswith("```"):
                content = content.split("```")[1]
                if content.startswith("json"):
                    content = content[4:]
                content = content.strip()

            results = json.loads(content)
            lookup = {}
            for item in results:
                lookup[item["id"]] = item.get("source", "Unknown")

            sources = []
            for i in range(batch_size):
                idx = start_idx + i + 1
                sources.append(lookup.get(idx, "Unknown"))
            return sources

        except json.JSONDecodeError as e:
            print(f"    [!] Source detection JSON error (attempt {attempt + 1}): {e}")
        except Exception as e:
            print(f"    [!] Source detection API error (attempt {attempt + 1}): {e}")

        if attempt < MAX_RETRIES - 1:
            wait = (2 ** attempt) + random.uniform(1, 3)
            time.sleep(wait)

    return ["Unknown"] * batch_size


def detect_sources(projects):
    """Detect original funding sources for a list of projects using DeepSeek AI.

    Modifies projects in-place, adding 'original_source' field.
    """
    if not projects:
        return

    print("\n" + "=" * 60)
    print("  AI Source Detection (DeepSeek)")
    print("=" * 60)
    print(f"  Projects to analyze: {len(projects)}")

    client = OpenAI(api_key=DEEPSEEK_API_KEY, base_url=DEEPSEEK_BASE_URL)

    # Prepare batches
    batches = []
    for batch_start in range(0, len(projects), BATCH_SIZE):
        batch = projects[batch_start : batch_start + BATCH_SIZE]
        batch_num = batch_start // BATCH_SIZE + 1
        batches.append((batch_num, batch_start, batch))

    total_batches = len(batches)
    lock = threading.Lock()
    completed = 0

    def process_batch(batch_info):
        nonlocal completed
        batch_num, batch_start, batch = batch_info
        sources = _detect_source_batch(client, batch, batch_start)

        for project, source in zip(batch, sources):
            project["original_source"] = source

        with lock:
            completed += 1
            print(f"    [Batch {batch_num}/{total_batches}] done ({completed}/{total_batches})")

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {executor.submit(process_batch, b): b for b in batches}
        for future in as_completed(futures):
            try:
                future.result()
            except Exception as e:
                batch_info = futures[future]
                print(f"    [!] Source batch {batch_info[0]} failed: {e}")

    # Count results
    detected = sum(1 for p in projects if p.get("original_source") and p["original_source"] != "Unknown")
    print(f"\n[+] Source detection complete: {detected}/{len(projects)} identified")


# ── 2. DOCUMENT SCRAPING ────────────────────────────────────────────────────

def scrape_documents(projects):
    """Visit detail pages and download documents for each project.

    Modifies projects in-place, adding 'documents' list field.
    Uses threads but with per-site rate limiting.
    """
    if not projects:
        return

    from utils.doc_scraper import scrape_and_download_docs

    print("\n" + "=" * 60)
    print("  Document Scraping & Download")
    print("=" * 60)
    print(f"  Projects to process: {len(projects)}")

    import requests as req
    session = req.Session()

    total_docs = 0
    for i, project in enumerate(projects, 1):
        title = (project.get("project_description", "") or project.get("project_name", ""))[:60]
        print(f"\n  [{i}/{len(projects)}] {title}...")

        docs = scrape_and_download_docs(project, session)
        project["documents"] = [
            {
                "filename": d["filename"],
                "url": d["url"],
                "size": d["size"],
                "title": d.get("title", ""),
                "extension": d.get("extension", ""),
            }
            for d in docs
        ]
        total_docs += len(docs)

        if docs:
            # Store local paths separately (not in DB, just for analysis step)
            project["_doc_paths"] = [d["path"] for d in docs]
            print(f"      ✅ {len(docs)} document(s) downloaded")
        else:
            project["_doc_paths"] = []
            print(f"      — No documents found")

        # Rate limit between projects
        if i < len(projects):
            time.sleep(1)

    print(f"\n[+] Document scraping complete: {total_docs} documents from {len(projects)} projects")


# ── 3. DOCUMENT ANALYSIS ────────────────────────────────────────────────────

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
            for page in pdf.pages[:30]:  # Limit to 30 pages
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
        # Unsupported format for text extraction
        return ""


def _analyze_document_text(client, text: str, doc_title: str) -> dict | None:
    """Send document text to DeepSeek for analysis."""
    for attempt in range(MAX_RETRIES):
        try:
            time.sleep(random.uniform(0.2, 0.8))

            user_prompt = f"Document title: {doc_title}\n\n---\n\n{text}"

            response = client.chat.completions.create(
                model=DEEPSEEK_MODEL,
                messages=[
                    {"role": "system", "content": DOC_ANALYSIS_PROMPT},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=0.0,
                max_tokens=4000,
            )

            content = response.choices[0].message.content.strip()

            # Handle markdown code blocks
            if content.startswith("```"):
                content = content.split("```")[1]
                if content.startswith("json"):
                    content = content[4:]
                content = content.strip()

            return json.loads(content)

        except json.JSONDecodeError as e:
            print(f"      [!] Doc analysis JSON error (attempt {attempt + 1}): {e}")
        except Exception as e:
            print(f"      [!] Doc analysis API error (attempt {attempt + 1}): {e}")

        if attempt < MAX_RETRIES - 1:
            wait = (2 ** attempt) + random.uniform(1, 3)
            time.sleep(wait)

    return None


def analyze_documents(projects):
    """Analyze downloaded documents using DeepSeek AI.

    Modifies projects in-place, adding 'doc_analysis' field.
    """
    # Filter to projects that have downloaded docs
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

            analysis = _analyze_document_text(client, text, doc_name)
            if analysis:
                analysis["document"] = doc_name
                all_analyses.append(analysis)
                print(f"      ✅ Analysis complete")
            else:
                print(f"      ❌ Analysis failed")

        if all_analyses:
            # Merge analyses if multiple docs
            if len(all_analyses) == 1:
                project["doc_analysis"] = all_analyses[0]
            else:
                project["doc_analysis"] = {
                    "documents_analyzed": len(all_analyses),
                    "analyses": all_analyses,
                }
            analyzed += 1

        # Clean up temporary field
        project.pop("_doc_paths", None)

    print(f"\n[+] Document analysis complete: {analyzed}/{len(projects_with_docs)} projects analyzed")


# ── MAIN PIPELINE ────────────────────────────────────────────────────────────


def run_enrichment(projects, skip_source=False, skip_docs=False, skip_analysis=False):
    """Run the full enrichment pipeline on a list of projects.

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

    # Stage 1: Source Detection
    if not skip_source:
        detect_sources(projects)

    # Stage 2: Document Scraping
    if not skip_docs:
        scrape_documents(projects)

    # Stage 3: Document Analysis (only if we downloaded docs)
    if not skip_docs and not skip_analysis:
        analyze_documents(projects)

    print("\n" + "#" * 60)
    print("  ENRICHMENT PIPELINE COMPLETE")
    print("#" * 60)
