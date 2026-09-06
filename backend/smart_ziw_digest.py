"""Post-sync email digest of new tenders.

Pure functions over plain dicts so the email content and SMTP behaviour can
be unit-tested without a mail server. Called from server.py after a
successful sync (and after auto-analysis) — a digest failure must never
break the sync, so the caller wraps send_digest in try/except.
"""

import logging
import smtplib
from datetime import datetime, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from html import escape

logger = logging.getLogger(__name__)

MAX_DIGEST_TENDERS = 50


def parse_recipients(raw) -> list[str]:
    """Accept a comma/semicolon-separated string or a list; return clean emails."""
    if isinstance(raw, str):
        items = raw.replace(";", ",").split(",")
    else:
        items = list(raw or [])
    seen = set()
    out = []
    for item in items:
        email = str(item).strip()
        if email and email.lower() not in seen:
            seen.add(email.lower())
            out.append(email)
    return out


def tender_link(config: dict, tender: dict) -> str:
    base = (config.get("app_base_url") or "").rstrip("/")
    db_id = tender.get("db_id") or ""
    return f"{base}/#/tenders/{db_id}" if base and db_id else ""


def _text_line(t: dict, link: str) -> str:
    parts = [p for p in (t.get("source"), t.get("country")) if p]
    meta = " | ".join(parts)
    flags = []
    if t.get("ai_verified") == "Yes":
        flags.append("verified")
    verdict = (t.get("smart_ziw_verdict") or "").strip()
    if verdict:
        flags.append(f"Smart-Ziw: {verdict}")
    if t.get("smart_ziw_status") == "error":
        flags.append("analysis failed")
    line = f"- {t.get('name') or 'Untitled tender'}"
    if meta:
        line += f" ({meta})"
    if t.get("deadline"):
        line += f" — deadline {t['deadline']}"
    if flags:
        line += f" [{', '.join(flags)}]"
    if link:
        line += f"\n  {link}"
    return line


def _html_row(t: dict, link: str) -> str:
    name = escape(str(t.get("name") or "Untitled tender"))
    parts = [escape(str(p)) for p in (t.get("source"), t.get("country")) if p]
    verdict = (t.get("smart_ziw_verdict") or "").strip()
    verdict_badge = ""
    if verdict:
        color = "#16a34a" if verdict.upper().startswith("GO") else "#d97706"
        verdict_badge = f' <span style="color:{color};font-weight:600;">{escape(verdict)}</span>'
    verified_badge = ' <span style="color:#16a34a;">&#10003;</span>' if t.get("ai_verified") == "Yes" else ""
    deadline = escape(str(t.get("deadline") or ""))
    link_html = f' <a href="{escape(link, quote=True)}">open</a>' if link else ""
    return (
        f"<li><strong>{name}</strong>{verified_badge}{verdict_badge}<br>"
        f"<span style=\"color:#666;font-size:13px;\">{ ' | '.join(parts) }{(' — deadline ' + deadline) if deadline else ''}{link_html}</span></li>"
    )


def build_digest(config: dict, tenders: list[dict], now: datetime | None = None):
    """Return (subject, text_body, html_body). Tenders should already be enriched."""
    now = now or datetime.now(timezone.utc)
    date_str = now.strftime("%Y-%m-%d %H:%M UTC")
    total = len(tenders)
    shown = tenders[:MAX_DIGEST_TENDERS]
    truncated = total - len(shown)

    subject = f"SmartZiw digest: {total} new tender{'s' if total != 1 else ''} ({date_str})"

    lines = [
        f"{total} new tender{'s' if total != 1 else ''} scraped at {date_str}.",
        "",
        *[_text_line(t, tender_link(config, t)) for t in shown],
    ]
    if truncated > 0:
        lines.append(f"... and {truncated} more in the app.")
    text_body = "\n".join(lines)

    base = (config.get("app_base_url") or "").rstrip("/")
    more_link = f'<p><a href="{escape(base, quote=True)}/#dashboard">Open dashboard</a></p>' if base else ""
    html_body = (
        f"<html><body>"
        f"<p>{total} new tender{'s' if total != 1 else ''} scraped at {date_str}.</p>"
        f"<ul style=\"line-height:1.6;padding-left:18px;\">"
        f"{''.join(_html_row(t, tender_link(config, t)) for t in shown)}"
        f"</ul>"
        f"{f'<p>... and {truncated} more in the app.</p>' if truncated > 0 else ''}"
        f"{more_link}"
        f"</body></html>"
    )
    return subject, text_body, html_body


def send_digest(config: dict, tenders: list[dict]) -> dict:
    """Build and send the digest. Returns {"sent": bool, "detail": str}."""
    recipients = parse_recipients(config.get("digest_recipients"))
    if not tenders:
        return {"sent": False, "detail": "no new tenders"}
    if not recipients:
        return {"sent": False, "detail": "no recipients configured"}
    host = (config.get("smtp_host") or "").strip()
    if not host:
        return {"sent": False, "detail": "SMTP host not configured"}
    try:
        port = int(config.get("smtp_port") or 587)
    except (TypeError, ValueError):
        port = 587

    subject, text_body, html_body = build_digest(config, tenders)
    from_addr = (config.get("smtp_from") or config.get("smtp_user") or "smartziw@localhost").strip()

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = from_addr
    msg["To"] = ", ".join(recipients)
    msg.attach(MIMEText(text_body, "plain", "utf-8"))
    msg.attach(MIMEText(html_body, "html", "utf-8"))

    if port == 465:
        smtp = smtplib.SMTP_SSL(host, port, timeout=30)
    else:
        smtp = smtplib.SMTP(host, port, timeout=30)
    try:
        smtp.ehlo()
        if port == 587:
            smtp.starttls()
            smtp.ehlo()
        user = (config.get("smtp_user") or "").strip()
        if user:
            smtp.login(user, config.get("smtp_password") or "")
        smtp.sendmail(from_addr, recipients, msg.as_string())
    finally:
        try:
            smtp.quit()
        except Exception:
            pass
    return {"sent": True, "detail": f"sent to {len(recipients)} recipient(s)"}
