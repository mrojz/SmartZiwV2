"""
IADB Procurement Page Scraper
==============================
Uses mitmproxy as a proxy to intercept ALL network requests
(including from iframes like Power BI) and extract MWCToken.
Then queries the Power BI API and saves results to Excel.

Requirements:
    pip install mitmproxy selenium webdriver-manager requests openpyxl

Usage:
    python iadb_scraper.py
"""

import json
import time
import random
import threading
import asyncio
import sys
import os
import requests
import urllib3
from datetime import datetime
from pathlib import Path

try:
    from openpyxl import Workbook
except ImportError:
    print("[!] openpyxl not installed. Run: pip install openpyxl")
    sys.exit(1)

# Disable SSL warnings for the API request
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# Global storage for captured tokens
captured_tokens = []
token_lock = threading.Lock()

# Store the actual proxy port once mitmproxy starts
active_proxy_port = None
proxy_port_lock = threading.Lock()

OUTPUT_FILE = "mwc_token.txt"
JSON_FILE = "mwc_token.json"


def find_free_port(range_start=10000, range_end=60000):
    """Find a random free port by attempting to bind to it."""
    import socket
    import random
    for _ in range(50):
        port = random.randint(range_start, range_end)
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.bind(('127.0.0.1', port))
                return port
        except OSError:
            continue
    raise RuntimeError("Could not find a free port after 50 attempts")


class MWCTokenInterceptor:
    """mitmproxy addon to intercept MWCToken."""
    
    def request(self, flow):
        url = flow.request.pretty_url
        auth = flow.request.headers.get("Authorization", "")
        
        # Log windows.net and powerbi requests
        if "windows.net" in url or "powerbi" in url.lower():
            print(f"[PROXY] {flow.request.method} {url[:100]}")
            if auth:
                print(f"        Auth: {auth[:80]}...")
        
        # Check for MWCToken
        if auth.startswith("MWCToken"):
            token_value = auth[len("MWCToken "):].strip()
            
            with token_lock:
                # Deduplicate
                if not any(t["token_value"] == token_value for t in captured_tokens):
                    token_info = {
                        "url": url,
                        "authorization": auth,
                        "token_value": token_value,
                        "captured_at": datetime.now().isoformat(),
                    }
                    captured_tokens.append(token_info)
                    
                    print("=" * 60)
                    print(f"[*] MWCToken CAPTURED!")
                    print(f"    URL: {url[:100]}")
                    print(f"    Token: {token_value[:50]}...")
                    print("=" * 60)
                    
                    # Save immediately
                    save_tokens()


def save_tokens():
    """Save captured tokens to files."""
    if not captured_tokens:
        return
    
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        for t in captured_tokens:
            f.write(f"URL:           {t['url']}\n")
            f.write(f"Authorization: {t['authorization']}\n")
            f.write(f"Token Value:   {t['token_value']}\n")
            f.write(f"Captured At:   {t['captured_at']}\n")
            f.write("-" * 80 + "\n")
    
    with open(JSON_FILE, "w", encoding="utf-8") as f:
        json.dump(captured_tokens, f, indent=2)
    
    print(f"[+] Saved {len(captured_tokens)} token(s) to '{OUTPUT_FILE}' and '{JSON_FILE}'")


def run_mitmproxy(port):
    """Run mitmproxy in a separate thread. Retries on a new random port if binding fails."""
    global active_proxy_port
    from mitmproxy import options
    from mitmproxy.tools import dump

    max_retries = 10
    current_port = port

    for attempt in range(max_retries):
        async def start_proxy(p):
            opts = options.Options(listen_port=p, ssl_insecure=True)
            master = dump.DumpMaster(opts)
            master.addons.add(MWCTokenInterceptor())
            print(f"[+] mitmproxy started on port {p}")
            with proxy_port_lock:
                global active_proxy_port
                active_proxy_port = p
            await master.run()

        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)

        try:
            loop.run_until_complete(start_proxy(current_port))
            break  # clean exit
        except OSError as e:
            print(f"[!] Port {current_port} in use, retrying... ({e})")
            current_port = find_free_port()
        except Exception as e:
            print(f"[!] mitmproxy error: {e}")
            break
        finally:
            loop.close()
    else:
        print(f"[!] Failed to start mitmproxy after {max_retries} attempts")


def create_selenium_driver(proxy_port=8001):
    """Create a Selenium Chrome driver configured to use mitmproxy."""
    from selenium import webdriver
    from selenium.webdriver.chrome.service import Service
    from selenium.webdriver.chrome.options import Options
    
    chrome_options = Options()
    
    # Headless mode for Docker (no display)
    chrome_options.add_argument("--headless=new")
    
    # Configure proxy
    chrome_options.add_argument(f"--proxy-server=http://127.0.0.1:{proxy_port}")
    
    # Ignore certificate errors (mitmproxy uses its own cert)
    chrome_options.add_argument("--ignore-certificate-errors")
    chrome_options.add_argument("--ignore-ssl-errors")
    chrome_options.add_argument("--allow-insecure-localhost")
    
    # Required for running as root in Docker
    chrome_options.add_argument("--disable-gpu")
    chrome_options.add_argument("--no-sandbox")
    chrome_options.add_argument("--disable-dev-shm-usage")
    chrome_options.add_argument("--window-size=1920,1080")
    
    import os
    chromedriver_path = os.environ.get("CHROMEDRIVER_PATH", "/usr/bin/chromedriver")
    chrome_bin = os.environ.get("CHROME_BIN")
    if chrome_bin:
        chrome_options.binary_location = chrome_bin
    
    driver = webdriver.Chrome(
        service=Service(chromedriver_path),
        options=chrome_options,
    )
    
    print("[+] Chrome driver created with proxy settings")
    return driver


def accept_cookies(driver):
    """Wait for and click the 'Accept All Cookies' button."""
    from selenium.webdriver.common.by import By
    from selenium.webdriver.support.ui import WebDriverWait
    from selenium.webdriver.support import expected_conditions as EC
    
    try:
        cookie_btn = WebDriverWait(driver, 15).until(
            EC.element_to_be_clickable((By.ID, "onetrust-accept-btn-handler"))
        )
        cookie_btn.click()
        print("[+] Accepted cookies.")
    except Exception as e:
        print(f"[!] Could not click cookie button: {e}")


def scroll_down(driver, pixels=600):
    """Scroll down the page."""
    driver.execute_script(f"window.scrollBy(0, {pixels});")
    print(f"[+] Scrolled down {pixels}px.")


def check_for_tokens():
    """Check if any tokens have been captured."""
    with token_lock:
        return len(captured_tokens) > 0


def send_powerbi_request(authorization_header, search_keyword="cybersecurity"):
    """Send the Power BI API request with the captured token for a specific keyword."""
    
    headers = {
        'Host': '74a9c2d515fa489c8a3be8cbbcdc5d6b.pbidedicated.windows.net',
        'X-Ms-Parent-Activity-Id': '0104ae6a-ddce-ab61-2325-a856e1d692ef',
        'Sec-Ch-Ua-Platform': '"Windows"',
        'Authorization': authorization_header,
        'Accept-Language': 'en-US,en;q=0.9',
        'Sec-Ch-Ua': '"Not(A:Brand";v="8", "Chromium";v="144"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Requestid': '0104ae6a-ddce-ab61-2325-a856e1d692ef',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
        'X-Ms-Root-Activity-Id': '0104ae6a-ddce-ab61-2325-a856e1d692ef',
        'Accept': 'application/json, text/plain, */*',
        'Content-Type': 'application/json;charset=UTF-8',
        'Activityid': '3d4dcbe3-ab6d-975f-f99b-7166537bdc79',
        'X-Ms-Workload-Resource-Moniker': '0ad785a0-58c7-49b6-b86b-f31b0970e292',
        'Origin': 'https://app.powerbi.com',
        'Sec-Fetch-Site': 'cross-site',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Dest': 'empty',
        'Referer': 'https://app.powerbi.com/',
        'Priority': 'u=1, i',
    }

    # Build the query with the search keyword
    json_data = {
        'version': '1.0.0',
        'queries': [
            {
                'Query': {
                    'Commands': [
                        {
                            'SemanticQueryDataShapeCommand': {
                                'Query': {
                                    'Version': 2,
                                    'From': [
                                        {
                                            'Name': 's',
                                            'Entity': 'sl_vw_prm_notices_public',
                                            'Type': 0,
                                        },
                                    ],
                                    'Select': [
                                        {
                                            'Column': {
                                                'Expression': {
                                                    'SourceRef': {
                                                        'Source': 's',
                                                    },
                                                },
                                                'Property': 'type',
                                            },
                                            'Name': 'sl_vw_prm_notices_public.type',
                                            'NativeReferenceName': 'Type',
                                        },
                                        {
                                            'Column': {
                                                'Expression': {
                                                    'SourceRef': {
                                                        'Source': 's',
                                                    },
                                                },
                                                'Property': 'countryname',
                                            },
                                            'Name': 'sl_vw_prm_notices_public.countryname',
                                            'NativeReferenceName': 'Country',
                                        },
                                        {
                                            'Column': {
                                                'Expression': {
                                                    'SourceRef': {
                                                        'Source': 's',
                                                    },
                                                },
                                                'Property': 'noticetitle',
                                            },
                                            'Name': 'sl_vw_prm_notices_public.noticetitle',
                                            'NativeReferenceName': 'Notice Title',
                                        },
                                        {
                                            'Column': {
                                                'Expression': {
                                                    'SourceRef': {
                                                        'Source': 's',
                                                    },
                                                },
                                                'Property': 'projectname',
                                            },
                                            'Name': 'sl_vw_prm_notices_public.projectname',
                                            'NativeReferenceName': 'Project Name',
                                        },
                                        {
                                            'Column': {
                                                'Expression': {
                                                    'SourceRef': {
                                                        'Source': 's',
                                                    },
                                                },
                                                'Property': 'projectnumber',
                                            },
                                            'Name': 'sl_vw_prm_notices_public.projectnumber',
                                            'NativeReferenceName': 'Project Number',
                                        },
                                        {
                                            'Column': {
                                                'Expression': {
                                                    'SourceRef': {
                                                        'Source': 's',
                                                    },
                                                },
                                                'Property': 'publicationdate',
                                            },
                                            'Name': 'sl_vw_prm_notices_public.publicationdate',
                                            'NativeReferenceName': 'Publication Date',
                                        },
                                        {
                                            'Column': {
                                                'Expression': {
                                                    'SourceRef': {
                                                        'Source': 's',
                                                    },
                                                },
                                                'Property': 'deadline',
                                            },
                                            'Name': 'sl_vw_prm_notices_public.deadline',
                                            'NativeReferenceName': 'Due Date',
                                        },
                                        {
                                            'Aggregation': {
                                                'Expression': {
                                                    'Column': {
                                                        'Expression': {
                                                            'SourceRef': {
                                                                'Source': 's',
                                                            },
                                                        },
                                                        'Property': 'documenturl',
                                                    },
                                                },
                                                'Function': 3,
                                            },
                                            'Name': 'Min(sl_vw_prm_notices_public.documenturl)',
                                        },
                                        {
                                            'Aggregation': {
                                                'Expression': {
                                                    'Column': {
                                                        'Expression': {
                                                            'SourceRef': {
                                                                'Source': 's',
                                                            },
                                                        },
                                                        'Property': 'proyecturl',
                                                    },
                                                },
                                                'Function': 3,
                                            },
                                            'Name': 'Min(sl_vw_prm_notices_public.proyecturl)',
                                        },
                                    ],
                                    'Where': [
                                        {
                                            'Condition': {
                                                'Contains': {
                                                    'Left': {
                                                        'Column': {
                                                            'Expression': {
                                                                'SourceRef': {
                                                                    'Source': 's',
                                                                },
                                                            },
                                                            'Property': 'noticetitle',
                                                        },
                                                    },
                                                    'Right': {
                                                        'Literal': {
                                                            'Value': f"'{search_keyword}'",
                                                        },
                                                    },
                                                },
                                            },
                                        },
                                    ],
                                    'OrderBy': [
                                        {
                                            'Direction': 2,
                                            'Expression': {
                                                'Column': {
                                                    'Expression': {
                                                        'SourceRef': {
                                                            'Source': 's',
                                                        },
                                                    },
                                                    'Property': 'publicationdate',
                                                },
                                            },
                                        },
                                    ],
                                },
                                'Binding': {
                                    'Primary': {
                                        'Groupings': [
                                            {
                                                'Projections': [
                                                    0,
                                                    1,
                                                    2,
                                                    3,
                                                    4,
                                                    5,
                                                    6,
                                                    7,
                                                    8,
                                                ],
                                            },
                                        ],
                                    },
                                    'DataReduction': {
                                        'DataVolume': 3,
                                        'Primary': {
                                            'Window': {
                                                'Count': 500,
                                            },
                                        },
                                    },
                                    'SuppressedJoinPredicates': [
                                        7,
                                        8,
                                    ],
                                    'Version': 1,
                                },
                                'ExecutionMetricsKind': 1,
                            },
                        },
                    ],
                },
                'QueryId': '',
                'ApplicationContext': {
                    'DatasetId': '0ad785a0-58c7-49b6-b86b-f31b0970e292',
                    'Sources': [
                        {
                            'ReportId': '8a3cf387-d650-401a-8d54-4b3efa166314',
                            'VisualId': 'd95671b50c060928b262',
                        },
                    ],
                },
            },
        ],
        'cancelQueries': [],
        'modelId': 14287704,
        'userPreferredLocale': 'en-US',
        'allowLongRunningQueries': True,
    }

    url = 'https://74a9c2d515fa489c8a3be8cbbcdc5d6b.pbidedicated.windows.net/webapi/capacities/74A9C2D5-15FA-489C-8A3B-E8CBBCDC5D6B/workloads/QES/QueryExecutionService/automatic/public/query'
    
    print(f"\n[>] Sending POST request for keyword: '{search_keyword}'")
    
    for attempt in range(3):
        try:
            response = requests.post(url, headers=headers, json=json_data, verify=False)
            
            if response.status_code == 200:
                result = response.json()
                print(f"    [+] Response received successfully")
                return result
            elif response.status_code == 429:
                wait = (2 ** attempt) + random.uniform(2, 5)
                print(f"    [!] Rate limited, waiting {wait:.1f}s...")
                time.sleep(wait)
                continue
            else:
                print(f"    [!] Request failed with status {response.status_code}")
                return None
        except Exception as e:
            if attempt < 2:
                wait = (2 ** attempt) + random.uniform(1, 3)
                print(f"    [!] Request error (attempt {attempt + 1}), retrying in {wait:.1f}s: {e}")
                time.sleep(wait)
            else:
                print(f"    [!] Request error: {e}")
                return None
    return None


from shared_excel import SEARCH_KEYWORDS, get_search_keywords, format_date, save_to_excel


def run_all_searches(authorization_header):
    """Run searches for all keywords and return unique projects."""
    # Dict keyed by (project_id, project_description) for deduplication
    unique_projects = {}
    
    print("\n" + "=" * 60)
    print("  Running Multi-Keyword Search")
    print("=" * 60)
    keywords = get_search_keywords()
    print(f"  Total keywords: {len(keywords)}")
    print("=" * 60)
    
    for i, keyword in enumerate(keywords, 1):
        print(f"\n[{i}/{len(keywords)}] Searching for: '{keyword}'")
        
        response = send_powerbi_request(authorization_header, keyword)
        
        if response:
            projects = parse_powerbi_response(response)
            
            new_count = 0
            for project in projects:
                # Deduplicate by (project_id, project_description)
                dedup_key = (project.get("project_id", ""), project.get("project_description", ""))
                if dedup_key in unique_projects:
                    # Append this keyword to the existing entry
                    existing = unique_projects[dedup_key]
                    if keyword not in existing["matched_keywords"]:
                        existing["matched_keywords"] += f", {keyword}"
                else:
                    project["matched_keywords"] = keyword
                    unique_projects[dedup_key] = project
                    new_count += 1
            
            print(f"    Found {len(projects)} results, {new_count} new unique")
            print(f"    Running total: {len(unique_projects)} unique projects")
        else:
            print(f"    No results for '{keyword}'")
        
        # Throttle between keyword searches to avoid rate limiting
        time.sleep(random.uniform(1.0, 2.5))
    
    all_projects = list(unique_projects.values())
    
    print("\n" + "=" * 60)
    print(f"  Total unique projects found: {len(all_projects)}")
    print("=" * 60)
    
    return all_projects


# format_date is now imported from shared_excel


def parse_powerbi_response(response_data):
    """Parse the Power BI DSR response correctly.
    
    DSR format:
    - DM0 rows: each row is one data record
    - First DM0 row contains "S" (schema) defining field types:
        T:1 = string, C value is an INDEX into ValueDicts[DN]
        T:7 = datetime, C value is a direct Unix-ms timestamp
    - "C" array: the data values for each row
    - "\u00d8" bitmask: indicates fields OMITTED (null) from C, shifting indices
    - "R" bitmask: indicates fields REPEATED from the previous row
    """
    projects = []
    
    try:
        results = response_data.get("results", [])
        if not results:
            print("[!] No results in response")
            return projects
        
        result = results[0].get("result", {})
        data = result.get("data", {})
        dsr = data.get("dsr", {})
        ds = dsr.get("DS", [])
        
        if not ds:
            print("[!] No DS data in response")
            return projects
        
        value_dicts = ds[0].get("ValueDicts", {})
        ph = ds[0].get("PH", [])
        dm0_rows = ph[0].get("DM0", []) if ph else []
        
        if not dm0_rows:
            print("[!] No DM0 rows in response")
            return projects
        
        # Extract schema from the first row's "S" field
        # Schema maps: field index -> {name, type, dict_name}
        schema = []
        first_row = dm0_rows[0]
        for field_def in first_row.get("S", []):
            schema.append({
                "name": field_def.get("N", ""),     # e.g. "G0", "G5", "M0"
                "type": field_def.get("T", 1),      # 1=string(dict index), 7=datetime
                "dict": field_def.get("DN", None),   # e.g. "D0", "D1", None for dates
            })
        
        num_fields = len(schema)
        if num_fields == 0:
            print("[!] No schema found in first DM0 row")
            return projects
        
        # Our query columns in schema order:
        # G0=type(D0), G1=country(D1), G2=noticetitle(D2), G3=projectname(D3),
        # G4=projectnumber(D4), G5=pubdate(timestamp), G6=deadline(timestamp),
        # M0=documenturl(D5), M1=proyecturl(D6)
        
        prev_values = [None] * num_fields  # for R (repeat) handling
        
        for row in dm0_rows:
            c_array = row.get("C", [])
            
            # Decode the \u00d8 (null/omit) bitmask - these fields are missing from C
            omit_mask = row.get("\u00d8", 0)
            # Decode the R (repeat) bitmask - these fields repeat from previous row
            repeat_mask = row.get("R", 0)
            
            # Build the full values array by expanding C with omit/repeat info
            values = [None] * num_fields
            c_idx = 0  # pointer into the C array
            
            for field_idx in range(num_fields):
                bit = 1 << field_idx
                
                if omit_mask & bit:
                    # Field is omitted (null) — not in C array
                    values[field_idx] = None
                elif repeat_mask & bit:
                    # Field repeats from previous row — not in C array
                    values[field_idx] = prev_values[field_idx]
                else:
                    # Field is present in C array
                    if c_idx < len(c_array):
                        values[field_idx] = c_array[c_idx]
                        c_idx += 1
                    else:
                        values[field_idx] = None
            
            # Resolve values using schema
            resolved = {}
            for field_idx, field_schema in enumerate(schema):
                raw = values[field_idx]
                name = field_schema["name"]
                
                if raw is None:
                    resolved[name] = ""
                elif field_schema["type"] == 7:
                    # Direct timestamp (Unix milliseconds)
                    resolved[name] = format_date(raw)
                elif field_schema["dict"]:
                    # Index into ValueDicts
                    dict_name = field_schema["dict"]
                    dict_list = value_dicts.get(dict_name, [])
                    idx = int(raw)
                    resolved[name] = dict_list[idx] if idx < len(dict_list) else ""
                else:
                    resolved[name] = str(raw)
            
            # Save current values for repeat handling in next row
            prev_values = values[:]
            
            # Map resolved fields to project dict
            project = {
                "project_id": resolved.get("G4", ""),
                "project_name": resolved.get("G3", ""),
                "project_start_date": resolved.get("G5", ""),
                "project_end_date": resolved.get("G6", ""),
                "project_description": resolved.get("G2", ""),
                "project_sponsor": resolved.get("G1", ""),
                "source": "IADB",
                "document_url": resolved.get("M0", ""),
                "project_url": resolved.get("M1", ""),
            }
            projects.append(project)
        
        print(f"[+] Parsed {len(projects)} projects from {len(dm0_rows)} DM0 rows")
        
    except Exception as e:
        print(f"[!] Error parsing response: {e}")
        import traceback
        traceback.print_exc()
    
    return projects


# save_to_excel is now imported from shared_excel


def run_iadb_scraper():
    """Run the full IADB scraping pipeline and return a list of project dicts."""
    global active_proxy_port
    TARGET_URL = "https://www.iadb.org/en/how-we-can-work-together/procurement/procurement-projects/procurement-notices"
    PROXY_PORT = find_free_port()

    print("\n" + "=" * 60)
    print("  IADB Procurement Notices Scraper")
    print("=" * 60)

    # 1. Start mitmproxy in a background thread
    print(f"\n[>] Starting mitmproxy on port {PROXY_PORT}...")
    proxy_thread = threading.Thread(target=run_mitmproxy, args=(PROXY_PORT,), daemon=True)
    proxy_thread.start()
    time.sleep(3)

    # Use the actual port mitmproxy bound to (may differ if retry happened)
    with proxy_port_lock:
        actual_port = active_proxy_port or PROXY_PORT
    print(f"[+] Using proxy port: {actual_port}")

    driver = None
    try:
        # 2. Create Selenium driver with proxy
        driver = create_selenium_driver(actual_port)

        # 3. Navigate to the page
        print(f"\n[>] Opening {TARGET_URL}")
        driver.get(TARGET_URL)

        # 4. Wait for initial page load
        print("[..] Waiting for page to load...")
        time.sleep(6)

        # 5. Accept cookies
        accept_cookies(driver)
        time.sleep(2)

        # 6. Scroll down to trigger Power BI loading
        print("[>] Scrolling to load Power BI content...")
        for _ in range(5):
            scroll_down(driver, pixels=500)
            time.sleep(1)

        # 7. Wait for Power BI to load and make API calls
        print("\n[..] Waiting for Power BI to load (up to 90 seconds)...")
        print("     Watch the output above for MWCToken captures")

        for i in range(30):
            time.sleep(3)
            print(f"  Waiting... {(i+1)*3}s | Tokens captured: {len(captured_tokens)}")

            if check_for_tokens():
                print("\n[+] MWCToken was captured! Closing browser...")
                driver.quit()
                driver = None
                break

        # 8. Show results
        print("\n" + "=" * 60)
        print(f"  Total MWCTokens captured: {len(captured_tokens)}")
        print("=" * 60)

        if captured_tokens:
            print("\n--- Token Preview ---")
            for i, t in enumerate(captured_tokens, 1):
                val = t["token_value"]
                preview = f"{val[:30]}...{val[-10:]}" if len(val) > 45 else val
                print(f"  [{i}] {preview}")

            # 9. Search ALL keywords and collect unique projects
            all_projects = run_all_searches(captured_tokens[0]["authorization"])
            return all_projects
        else:
            print("[!] No MWCToken found in any windows.net request.")
            return []

    except Exception as e:
        import traceback
        print(f"[!] Error: {str(e)}")
        traceback.print_exc()
        return []

    finally:
        if driver:
            print("\n[>] Closing browser...")
            driver.quit()
            print("[+] Browser closed")
        save_tokens()


def main():
    """Standalone mode: run IADB scraper and save to Excel."""
    projects = run_iadb_scraper()

    if projects:
        save_to_excel(projects, filename="projects.xlsx")

        with open("iadb_projects.json", "w", encoding="utf-8") as f:
            json.dump(projects, f, indent=2, ensure_ascii=False)
        print(f"[+] Also saved to 'iadb_projects.json'")
    else:
        print("[!] No projects found across all keyword searches.")

    print("[+] Done.")


if __name__ == "__main__":
    main()
