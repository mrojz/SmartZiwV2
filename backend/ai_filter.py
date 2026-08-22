"""
AI-powered cybersecurity relevance filter using DeepSeek API.

Sends ONLY new/unverified projects in small batches to DeepSeek.
Uses multiple threads for faster processing.
Marks each project with ai_verified = "Yes" or "No" instead of removing them.
"""

import json
import os
import time
import random
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv(override=False)


# ── Configuration ────────────────────────────────────────────────────────────

DEEPSEEK_API_KEY = os.environ.get("DEEPSEEK_API_KEY", "")
DEEPSEEK_BASE_URL = os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
DEEPSEEK_MODEL = "deepseek-chat"

BATCH_SIZE = 2       # Smaller batches for reliability
MAX_WORKERS = 4      # Concurrent threads

FALLBACK_SYSTEM_PROMPT = """You are a cybersecurity procurement analyst. Your job is to determine whether procurement notices are related to cybersecurity, information security, or IT security.

A project IS cybersecurity-related if it involves:
- Penetration testing, vulnerability assessments, ethical hacking
- Security audits, ISMS, ISO 27001, PCI DSS compliance
- Cybersecurity strategy, frameworks, NIST, CISO advisory
- SIEM, SOC, CERT, incident response
- Network security, firewall, endpoint protection
- Data protection, encryption, privacy (GDPR, etc.)
- Security awareness, phishing simulations, social engineering
- OT/ICS security, SCADA security
- SWIFT CSP, DORA, financial security compliance
- Digital forensics, threat intelligence, malware analysis
- Identity & access management (IAM), authentication, MFA
- Cloud security, application security, DevSecOps
- Security training and certification programs

A project is NOT cybersecurity-related if it only mentions security in passing (e.g. physical security, food safety, social security, guard services) or is a general IT/digital project with no specific security focus.

You will receive a numbered list of projects. For each project, respond with ONLY a JSON array of objects:
[{"id": 1, "cyber": true, "reason": "..."}, {"id": 2, "cyber": false}, ...]

For every project where cyber is true, include a concise reason explaining why the tender is cybersecurity-related. If cyber is false, you may omit reason or set it to an empty string.

Do not include any explanation outside the JSON array."""


def _build_system_prompt(config):
    """Build the final system prompt from config, falling back to defaults."""
    if config is None:
        try:
            from database import get_smart_ziw_config
            config = get_smart_ziw_config()
        except Exception:
            config = {}

    base = config.get('ai_verification_system_prompt') or FALLBACK_SYSTEM_PROMPT
    expertise = config.get('ai_verification_expertise', '')
    unwanted = config.get('ai_verification_unwanted', '')

    return (
        base
        + "\n\nCompany expertise / focus:\n"
        + expertise
        + "\n\nUnwanted services/products (a project that is ONLY about these should NOT be labeled cybersecurity-related):\n"
        + unwanted
    )


def _build_batch_prompt(projects_batch, start_idx):
    """Build a numbered list of projects for the AI to evaluate."""
    lines = []
    for i, p in enumerate(projects_batch):
        idx = start_idx + i + 1
        title = p.get("project_description", "") or p.get("project_name", "")
        name = p.get("project_name", "")
        country = p.get("project_sponsor", "")
        source = p.get("source", "")
        lines.append(f"{idx}. [{source}] [{country}] {title} | Project: {name}")
    return "\n".join(lines)


def verify_batch(client, projects_batch, start_idx, system_prompt, max_retries=3):
    """Send a batch of projects to DeepSeek and return a list of verdict dicts.

    Each verdict is {"cyber": bool, "reason": str}. Thread-safe.
    """
    prompt = _build_batch_prompt(projects_batch, start_idx)
    batch_size = len(projects_batch)

    for attempt in range(max_retries):
        try:
            # Stagger requests slightly to avoid bursts
            time.sleep(random.uniform(0.1, 0.5))

            response = client.chat.completions.create(
                model=DEEPSEEK_MODEL,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": prompt},
                ],
                temperature=0.0,
                max_tokens=2000,
            )

            content = response.choices[0].message.content.strip()

            # Extract JSON from response (handle markdown code blocks)
            if content.startswith("```"):
                content = content.split("```")[1]
                if content.startswith("json"):
                    content = content[4:]
                content = content.strip()

            results = json.loads(content)

            # Build a lookup from id -> verdict dict
            lookup = {}
            for item in results:
                lookup[item["id"]] = {
                    "cyber": bool(item.get("cyber", False)),
                    "reason": str(item.get("reason", "")).strip(),
                }

            # Map back to batch order
            verdicts = []
            for i in range(batch_size):
                idx = start_idx + i + 1
                verdicts.append(lookup.get(idx, {"cyber": False, "reason": ""}))

            return verdicts

        except json.JSONDecodeError as e:
            print(f"    [!] JSON parse error (attempt {attempt + 1}): {e}")
            print(f"    Raw response: {content[:200]}")
        except Exception as e:
            print(f"    [!] API error (attempt {attempt + 1}): {e}")

        if attempt < max_retries - 1:
            wait = (2 ** attempt) + random.uniform(1, 3)
            print(f"    Retrying in {wait:.1f}s...")
            time.sleep(wait)

    # If all retries fail, mark as unverified (keep them, will retry next run)
    print(f"    [!] All retries failed, marking batch as unverified")
    return [None] * batch_size


def filter_cybersecurity_projects(projects, config=None, post_comment_callback=None):
    """Verify projects using DeepSeek AI with concurrent threads.

    Args:
        projects: list of NEW project dicts to verify
        config: optional Smart-Ziw config dict; loaded from DB if None
        post_comment_callback: optional callable(project, reason) invoked for AI-verified projects

    Returns:
        Same list of projects, each with 'ai_verified' and 'ai_verification_reason' fields added.
    """
    if not projects:
        return []

    system_prompt = _build_system_prompt(config)
    total_batches = (len(projects) + BATCH_SIZE - 1) // BATCH_SIZE

    print("\n" + "=" * 60)
    print("  AI Cybersecurity Verification (DeepSeek)")
    print("=" * 60)
    print(f"  Projects to verify: {len(projects)}")
    print(f"  Batch size: {BATCH_SIZE}  |  Batches: {total_batches}  |  Threads: {MAX_WORKERS}")
    print("=" * 60)

    client = OpenAI(api_key=DEEPSEEK_API_KEY, base_url=DEEPSEEK_BASE_URL)

    # Prepare all batches: list of (batch_num, start_idx, batch_slice)
    batches = []
    for batch_start in range(0, len(projects), BATCH_SIZE):
        batch = projects[batch_start : batch_start + BATCH_SIZE]
        batch_num = batch_start // BATCH_SIZE + 1
        batches.append((batch_num, batch_start, batch))

    # Thread-safe counters
    lock = threading.Lock()
    verified_yes = 0
    verified_no = 0
    completed = 0

    def process_batch(batch_info):
        """Process a single batch — runs inside a thread."""
        nonlocal verified_yes, verified_no, completed
        batch_num, batch_start, batch = batch_info

        verdicts = verify_batch(client, batch, batch_start, system_prompt)

        batch_yes = 0
        batch_no = 0
        rejected_titles = []

        for project, verdict in zip(batch, verdicts):
            if verdict is None:
                project["ai_verified"] = ""
                project["ai_verification_reason"] = ""
                continue

            cyber = verdict.get("cyber", False)
            reason = verdict.get("reason", "")

            if cyber is True:
                project["ai_verified"] = "Yes"
                project["ai_verification_reason"] = reason
                batch_yes += 1
                if post_comment_callback is not None:
                    try:
                        post_comment_callback(project, reason)
                    except Exception as e:
                        print(f"    [!] post_comment_callback failed for {project.get('project_name', '')}: {e}")
            else:
                project["ai_verified"] = "No"
                project["ai_verification_reason"] = ""
                batch_no += 1
                title = (project.get("project_description", "") or project.get("project_name", ""))[:80]
                rejected_titles.append(title)

        with lock:
            verified_yes += batch_yes
            verified_no += batch_no
            completed += 1
            # Print progress under lock to avoid garbled output
            for title in rejected_titles:
                print(f"    [x] Not cyber: {title}")
            print(
                f"    [Batch {batch_num}/{total_batches}] "
                f"+{batch_yes} cyber, +{batch_no} not cyber  "
                f"({completed}/{total_batches} done)"
            )

    # Run batches concurrently
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {executor.submit(process_batch, b): b for b in batches}
        for future in as_completed(futures):
            try:
                future.result()  # propagate any uncaught exceptions
            except Exception as e:
                batch_info = futures[future]
                print(f"    [!] Batch {batch_info[0]} failed: {e}")

    print(f"\n[+] AI verification complete: {verified_yes} cyber, {verified_no} not cyber")
    return projects
