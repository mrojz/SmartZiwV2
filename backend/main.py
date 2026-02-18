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
    python main.py --no-ai             # Skip AI cybersecurity verification
    python main.py --include-expired   # Include projects with past due dates
"""

import argparse

from database import get_all_projects, upsert_projects
from shared_excel import save_to_excel, is_expired


OUTPUT_XLSX = "projects.xlsx"


def main():
    parser = argparse.ArgumentParser(
        description="Procurement Notice Scraper — IADB, World Bank, Global Tenders & GIZ"
    )
    parser.add_argument("--iadb", action="store_true", help="Run only the IADB scraper")
    parser.add_argument("--worldbank", action="store_true", help="Run only the World Bank scraper")
    parser.add_argument("--globaltenders", action="store_true", help="Run only the Global Tenders scraper")
    parser.add_argument("--giz", action="store_true", help="Run only the GIZ scraper")
    parser.add_argument("--devaid", action="store_true", help="Run only the DevelopmentAid scraper")
    parser.add_argument("--dgmarket", action="store_true", help="Run only the DGMarket scraper")
    parser.add_argument("--no-ai", action="store_true", help="Skip AI cybersecurity verification")
    parser.add_argument("--include-expired", action="store_true", help="Include projects with past due dates")
    args = parser.parse_args()

    # If no source flag is set, run all
    any_source = args.iadb or args.worldbank or args.globaltenders or args.giz or args.devaid or args.dgmarket
    run_iadb = args.iadb or not any_source
    run_wb = args.worldbank or not any_source
    run_gt = args.globaltenders or not any_source
    run_giz = args.giz or not any_source
    run_devaid = args.devaid or not any_source
    run_dgmarket = args.dgmarket or not any_source

    # ── 1. Load existing projects from MongoDB ────────────────────────────
    existing_rows = get_all_projects()
    existing_keys = {
        (str(p.get("project_id", "")), str(p.get("project_name", "")))
        for p in existing_rows
    }
    print(f"[i] Existing projects in DB: {len(existing_rows)}")

    # ── 2. Scrape from sources ────────────────────────────────────────────
    scraped = []

    if run_iadb:
        try:
            from utils.iadb_scraper import run_iadb_scraper
            iadb_projects = run_iadb_scraper()
            print(f"\n[+] IADB returned {len(iadb_projects)} projects")
            scraped.extend(iadb_projects)
        except Exception as e:
            print(f"\n[!] IADB scraper error: {e}")

    if run_wb:
        try:
            from utils.wb_scraper import run_wb_scraper
            wb_projects = run_wb_scraper()
            print(f"\n[+] World Bank returned {len(wb_projects)} projects")
            scraped.extend(wb_projects)
        except Exception as e:
            print(f"\n[!] World Bank scraper error: {e}")

    if run_gt:
        try:
            from utils.gt_scraper import run_gt_scraper
            gt_projects = run_gt_scraper()
            print(f"\n[+] Global Tenders returned {len(gt_projects)} projects")
            scraped.extend(gt_projects)
        except Exception as e:
            print(f"\n[!] Global Tenders scraper error: {e}")

    if run_giz:
        try:
            from utils.giz_scraper import run_giz_scraper
            giz_projects = run_giz_scraper()
            print(f"\n[+] GIZ returned {len(giz_projects)} projects")
            scraped.extend(giz_projects)
        except Exception as e:
            print(f"\n[!] GIZ scraper error: {e}")

    if run_devaid:
        try:
            from utils.devaid_scraper import run_devaid_scraper
            devaid_projects = run_devaid_scraper()
            print(f"\n[+] DevelopmentAid returned {len(devaid_projects)} projects")
            scraped.extend(devaid_projects)
        except Exception as e:
            print(f"\n[!] DevelopmentAid scraper error: {e}")

    if run_dgmarket:
        try:
            from utils.dgmarket_scraper import run_dgmarket_scraper
            dgmarket_projects = run_dgmarket_scraper()
            print(f"\n[+] DGMarket returned {len(dgmarket_projects)} projects")
            scraped.extend(dgmarket_projects)
        except Exception as e:
            print(f"\n[!] DGMarket scraper error: {e}")

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
    print(f"\n[+] Total unique scraped projects: {len(all_scraped)}")

    # ── 4. Find NEW projects (not already in DB) ─────────────────────────
    new_projects = []
    for p in all_scraped:
        key = (str(p.get("project_id", "")), str(p.get("project_name", "")))
        if key not in existing_keys:
            new_projects.append(p)

    print(f"[+] New projects (not in DB): {len(new_projects)}")

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
            print(f"[+] Filtered out {expired} expired projects")
        print(f"[+] New projects after filtering: {len(new_projects)}")
    elif args.include_expired:
        print("[i] Expiry filter disabled (--include-expired)")

    # ── 7. AI Cybersecurity Verification ──────────────────────────────────
    if not args.no_ai:
        from ai_filter import filter_cybersecurity_projects

        # Verify new projects
        if new_projects:
            new_projects = filter_cybersecurity_projects(new_projects)

        # Also verify existing projects that haven't been AI-checked yet
        unverified = [r for r in existing_rows if not r.get("ai_verified")]
        if unverified:
            print(f"\n[i] Found {len(unverified)} existing unverified projects — running AI check")
            filter_cybersecurity_projects(unverified)
            # Save updated AI verification results back to DB
            upsert_projects(unverified)
    else:
        print("[i] AI verification skipped (--no-ai flag)")

    # ── 8. Save new projects to MongoDB ───────────────────────────────────
    if not new_projects and not any(not r.get("ai_verified") for r in existing_rows):
        print("[i] No new projects found. Database unchanged.")
        print("[+] Done.")
        return

    if new_projects:
        result = upsert_projects(new_projects)
        print(f"\n[+] Saved to MongoDB: {result['inserted']} inserted, {result['updated']} updated")

    # Also generate Excel export
    all_projects = get_all_projects()

    print("\n" + "=" * 60)
    print(f"  Existing: {len(existing_rows)}  |  New: {len(new_projects)}  |  Total: {len(all_projects)}")
    print("=" * 60)

    save_to_excel(all_projects, filename=OUTPUT_XLSX)
    print(f"[+] Excel exported to '{OUTPUT_XLSX}'")
    print("[+] Done.")


if __name__ == "__main__":
    main()
