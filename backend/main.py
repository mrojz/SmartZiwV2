"""
Main launcher for procurement notice scrapers.

Usage:
    python main.py                      # Run all scrapers with AI filter
    python main.py --iadb               # Run only IADB scraper
    python main.py --worldbank          # Run only World Bank scraper
    python main.py --globaltenders      # Run only Global Tenders scraper
    python main.py --giz                # Run only GIZ scraper
    python main.py --devaid             # Run only DevelopmentAid scraper
    python main.py --dgmarket           # Run only DGMarket scraper
    python main.py --isdb               # Run only IsDB scraper
    python main.py --badea              # Run only BADEA scraper
    python main.py --bcie               # Run only BCIE scraper
    python main.py --eabr               # Run only EABR scraper
    python main.py --oas                # Run only OAS scraper
    python main.py --africanunion       # Run only African Union scraper
    python main.py --no-ai             # Skip AI cybersecurity verification
    python main.py --include-expired   # Include projects with past due dates
"""

import argparse
import io
import json
import sys
import time
import contextlib
from concurrent.futures import ThreadPoolExecutor, as_completed

from database import get_all_projects, upsert_projects
from shared_excel import save_to_excel, is_expired


OUTPUT_XLSX = "projects.xlsx"


def _configure_stdio():
    for stream_name in ("stdout", "stderr", "__stdout__", "__stderr__"):
        stream = getattr(sys, stream_name, None)
        reconfigure = getattr(stream, "reconfigure", None)
        if callable(reconfigure):
            try:
                reconfigure(encoding="utf-8", errors="replace")
            except Exception:
                pass

# ── Scraper definitions ───────────────────────────────────────────────────────

SCRAPERS = {
    "iadb": {
        "label": "IADB",
        "import": "from utils.iadb_scraper import run_iadb_scraper",
        "func": "run_iadb_scraper",
    },
    "worldbank": {
        "label": "World Bank",
        "import": "from utils.wb_scraper import run_wb_scraper",
        "func": "run_wb_scraper",
    },
    "globaltenders": {
        "label": "Global Tenders",
        "import": "from utils.gt_scraper import run_gt_scraper",
        "func": "run_gt_scraper",
    },
    "giz": {
        "label": "GIZ",
        "import": "from utils.giz_scraper import run_giz_scraper",
        "func": "run_giz_scraper",
    },
    "devaid": {
        "label": "DevelopmentAid",
        "import": "from utils.devaid_scraper import run_devaid_scraper",
        "func": "run_devaid_scraper",
    },
    "dgmarket": {
        "label": "DGMarket",
        "import": "from utils.dgmarket_scraper import run_dgmarket_scraper",
        "func": "run_dgmarket_scraper",
    },
    "africagateway": {
        "label": "Africa Gateway",
        "import": "from utils.ag_scraper import run_ag_scraper",
        "func": "run_ag_scraper",
    },
    "isdb": {
        "label": "IsDB",
        "import": "from utils.isdb_scraper import run_isdb_scraper",
        "func": "run_isdb_scraper",
    },
    "badea": {
        "label": "BADEA",
        "import": "from utils.badea_scraper import run_badea_scraper",
        "func": "run_badea_scraper",
    },
    "bcie": {
        "label": "BCIE",
        "import": "from utils.bcie_scraper import run_bcie_scraper",
        "func": "run_bcie_scraper",
    },
    "eabr": {
        "label": "EABR",
        "import": "from utils.eabr_scraper import run_eabr_scraper",
        "func": "run_eabr_scraper",
    },
    "oas": {
        "label": "OAS",
        "import": "from utils.oas_scraper import run_oas_scraper",
        "func": "run_oas_scraper",
    },
    "africanunion": {
        "label": "African Union",
        "import": "from utils.africanunion_scraper import run_africanunion_scraper",
        "func": "run_africanunion_scraper",
    },
}


def _run_single_scraper(key: str, info: dict) -> dict:
    """Run one scraper, capturing its stdout/stderr separately.
    
    Returns a dict with: key, label, projects, output, error, duration.
    """
    label = info["label"]
    buf = io.StringIO()
    projects = []
    error = None
    start = time.time()

    # Tee writer: captures output to buffer AND prints to real stdout for live SSE
    real_stdout = sys.__stdout__
    class TeeWriter:
        def write(self, s):
            buf.write(s)
            try:
                real_stdout.write(s)
                real_stdout.flush()
            except (UnicodeEncodeError, OSError):
                real_stdout.write(s.encode('ascii', 'replace').decode('ascii'))
                real_stdout.flush()
        def flush(self):
            real_stdout.flush()
        def isatty(self):
            return False
        def fileno(self):
            return real_stdout.fileno()
        @property
        def encoding(self):
            return getattr(real_stdout, 'encoding', 'utf-8')

    try:
        # Import the scraper function
        ns = {}
        exec(info["import"], ns)
        func = ns[info["func"]]

        # Capture output to both buffer and real stdout
        tee = TeeWriter()
        with contextlib.redirect_stdout(tee), contextlib.redirect_stderr(tee):
            projects = func()
    except Exception as e:
        error = str(e)
        buf.write(f"\n[!] {label} scraper error: {e}\n")

    duration = round(time.time() - start, 1)
    return {
        "key": key,
        "label": label,
        "projects": projects or [],
        "output": buf.getvalue(),
        "error": error,
        "duration": duration,
    }


def main():
    _configure_stdio()

    parser = argparse.ArgumentParser(
        description="Procurement Notice Scraper — IADB, World Bank, Global Tenders & GIZ"
    )
    parser.add_argument("--iadb", action="store_true", help="Run only the IADB scraper")
    parser.add_argument("--worldbank", action="store_true", help="Run only the World Bank scraper")
    parser.add_argument("--globaltenders", action="store_true", help="Run only the Global Tenders scraper")
    parser.add_argument("--giz", action="store_true", help="Run only the GIZ scraper")
    parser.add_argument("--devaid", action="store_true", help="Run only the DevelopmentAid scraper")
    parser.add_argument("--dgmarket", action="store_true", help="Run only the DGMarket scraper")
    parser.add_argument("--africagateway", action="store_true", help="Run only the Africa Gateway scraper")
    parser.add_argument("--isdb", action="store_true", help="Run only the IsDB scraper")
    parser.add_argument("--badea", action="store_true", help="Run only the BADEA scraper")
    parser.add_argument("--bcie", action="store_true", help="Run only the BCIE scraper")
    parser.add_argument("--eabr", action="store_true", help="Run only the EABR scraper")
    parser.add_argument("--oas", action="store_true", help="Run only the OAS scraper")
    parser.add_argument("--africanunion", action="store_true", help="Run only the African Union scraper")
    parser.add_argument("--no-ai", action="store_true", help="Skip AI cybersecurity verification")
    parser.add_argument("--no-enrich", action="store_true", help="Skip AI enrichment (source detection, doc analysis)")
    parser.add_argument("--include-expired", action="store_true", help="Include projects with past due dates")
    args = parser.parse_args()

    # Determine which scrapers to run
    any_source = args.iadb or args.worldbank or args.globaltenders or args.giz or args.devaid or args.dgmarket or args.africagateway or args.isdb or args.badea or args.bcie or args.eabr or args.oas or args.africanunion
    to_run = {}
    for key, info in SCRAPERS.items():
        if getattr(args, key, False) or not any_source:
            to_run[key] = info

    # ── 1. Load existing projects from MongoDB ────────────────────────────
    existing_rows = get_all_projects()
    existing_keys = {
        (str(p.get("project_id", "")), str(p.get("project_name", "")))
        for p in existing_rows
    }
    print(f"[i] Existing projects in DB: {len(existing_rows)}", flush=True)
    print(f"[i] Running {len(to_run)} scrapers in parallel: {', '.join(info['label'] for info in to_run.values())}", flush=True)

    # ── 2. Run scrapers in parallel threads ───────────────────────────────
    results = {}
    scraper_logs = {}
    scraped = []

    for key in to_run:
        print(f"[..] {to_run[key]['label']}: starting...", flush=True)

    with ThreadPoolExecutor(max_workers=len(to_run)) as pool:
        futures = {
            pool.submit(_run_single_scraper, key, info): key
            for key, info in to_run.items()
        }

        for future in as_completed(futures):
            key = futures[future]
            result = future.result()
            results[key] = result
            scraper_logs[key] = result["output"]

            count = len(result["projects"])
            duration = result["duration"]

            if result["error"]:
                print(f"[!!] {result['label']}: failed ({duration}s) — {result['error']}", flush=True)
            else:
                print(f"[OK] {result['label']}: {count} projects ({duration}s)", flush=True)

            scraped.extend(result["projects"])

    # ── 3. Deduplicate scraped results ────────────────────────────────────
    seen = {}
    for p in scraped:
        key = (p.get("project_id", ""), p.get("project_description", ""))
        if key in seen:
            existing = seen[key]
            kw_set = set(existing.get("matched_keywords", "").split(", "))
            kw_set.update(p.get("matched_keywords", "").split(", "))
            kw_set.discard("")
            existing["matched_keywords"] = ", ".join(sorted(kw_set))
            src_set = set(existing.get("source", "").split(", "))
            src_set.add(p.get("source", ""))
            src_set.discard("")
            existing["source"] = ", ".join(sorted(src_set))
        else:
            seen[key] = p

    all_scraped = list(seen.values())
    print(f"[i] Total unique scraped: {len(all_scraped)}", flush=True)

    # ── 4. Find NEW projects (not already in DB) ─────────────────────────
    new_projects = []
    for p in all_scraped:
        key = (str(p.get("project_id", "")), str(p.get("project_name", "")))
        if key not in existing_keys:
            new_projects.append(p)

    print(f"[i] New projects: {len(new_projects)}", flush=True)

    # ── 5. Enrich new WB projects with detail API ─────────────────────────
    if new_projects:
        wb_new = [p for p in new_projects if p.get("source") == "World Bank"]
        if wb_new:
            from utils.wb_scraper import fetch_project_details, enrich_with_details
            project_ids = [p["project_id"] for p in wb_new]
            details = fetch_project_details(project_ids)
            enrich_with_details(wb_new, details)

    # ── 6. Filter out expired projects (due date passed) ──────────────────
    if new_projects and not args.include_expired:
        before = len(new_projects)
        new_projects = [p for p in new_projects if not is_expired(p)]
        expired = before - len(new_projects)
        if expired:
            print(f"[i] Filtered out {expired} expired projects", flush=True)
    elif args.include_expired:
        print("[i] Expiry filter disabled (--include-expired)", flush=True)

    # ── 7. AI Cybersecurity Verification ──────────────────────────────────
    ai_verified_count = 0
    ai_rejected_count = 0

    if not args.no_ai:
        from ai_filter import filter_cybersecurity_projects

        print("[..] AI verification: starting...", flush=True)

        # Verify new projects
        if new_projects:
            new_projects = filter_cybersecurity_projects(new_projects)
            ai_verified_count += sum(1 for p in new_projects if p.get("ai_verified") == "Yes")
            ai_rejected_count += sum(1 for p in new_projects if p.get("ai_verified") == "No")

        # Also verify existing projects that haven't been AI-checked yet
        unverified = [r for r in existing_rows if not r.get("ai_verified")]
        if unverified:
            print(f"[i] Re-verifying {len(unverified)} existing unverified projects", flush=True)
            filter_cybersecurity_projects(unverified)
            upsert_projects(unverified)
            ai_verified_count += sum(1 for p in unverified if p.get("ai_verified") == "Yes")
            ai_rejected_count += sum(1 for p in unverified if p.get("ai_verified") == "No")

        print(f"[OK] AI verification: {ai_verified_count} validated, {ai_rejected_count} rejected", flush=True)
    else:
        print("[i] AI verification skipped (--no-ai flag)", flush=True)

    # ── 8. AI Enrichment (document download + analysis) ─────────────────
    enrichment_stats = {"docs_downloaded": 0, "docs_analyzed": 0}

    if not args.no_enrich and not args.no_ai:
        enrichable = [p for p in new_projects if p.get("ai_verified") == "Yes"]
        if enrichable:
            from ai_enrichment import run_enrichment

            print(f"[..] AI enrichment: processing {len(enrichable)} verified projects...", flush=True)
            run_enrichment(enrichable)

            enrichment_stats["docs_downloaded"] = sum(
                len(p.get("documents", [])) for p in enrichable
            )
            enrichment_stats["docs_analyzed"] = sum(
                1 for p in enrichable if p.get("doc_analysis")
            )
            print(
                f"[OK] Enrichment: "
                f"{enrichment_stats['docs_downloaded']} docs downloaded, "
                f"{enrichment_stats['docs_analyzed']} analyzed",
                flush=True,
            )
        else:
            print("[i] No verified projects to enrich", flush=True)
    elif args.no_enrich:
        print("[i] AI enrichment skipped (--no-enrich flag)", flush=True)

    # ── 9. Save new projects to MongoDB ───────────────────────────────────
    if not new_projects and not any(not r.get("ai_verified") for r in existing_rows):
        print("[i] No new projects found. Database unchanged.", flush=True)
    elif new_projects:
        result = upsert_projects(new_projects)
        print(f"[OK] Saved: {result['inserted']} inserted, {result['updated']} updated", flush=True)

    # Also generate Excel export
    all_projects = get_all_projects()
    save_to_excel(all_projects, filename=OUTPUT_XLSX)

    # ── 10. Print structured summary (for server.py to parse) ─────────────
    summary = {
        "total_scraped": len(all_scraped),
        "new_projects": len(new_projects),
        "total_projects": len(all_projects),
        "ai_verified": ai_verified_count,
        "ai_rejected": ai_rejected_count,
        "enrichment": enrichment_stats,
        "scrapers": {},
    }
    for key, result in results.items():
        summary["scrapers"][key] = {
            "label": result["label"],
            "count": len(result["projects"]),
            "error": result["error"],
            "duration": result["duration"],
        }

    # Output summary as a special tagged JSON line for server.py to parse
    print(f"__SUMMARY__{json.dumps(summary)}__END__", flush=True)

    # Output per-scraper logs as tagged JSON for server.py to capture
    for key, log_text in scraper_logs.items():
        encoded = json.dumps({"key": key, "label": results[key]["label"], "output": log_text})
        print(f"__SCRAPER_LOG__{encoded}__END__", flush=True)

    print("[+] Done.", flush=True)


if __name__ == "__main__":
    main()
