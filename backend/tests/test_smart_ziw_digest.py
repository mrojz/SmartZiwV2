import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import smart_ziw_digest as digest


def _config(**overrides):
    base = {
        "digest_recipients": ["a@example.com", "b@example.com"],
        "smtp_host": "smtp.example.com",
        "smtp_port": 587,
        "smtp_user": "u",
        "smtp_password": "p",
        "smtp_from": "smartziw@example.com",
        "app_base_url": "http://server:8080",
    }
    base.update(overrides)
    return base


def _tender(**overrides):
    base = {
        "project_id": "P1",
        "name": "Firewall procurement",
        "source": "World Bank",
        "country": "Niger",
        "deadline": "2026-10-01",
        "ai_verified": "Yes",
        "db_id": "abc123",
        "smart_ziw_verdict": "GO",
        "smart_ziw_status": "completed",
    }
    base.update(overrides)
    return base


def test_parse_recipients_handles_strings_lists_and_duplicates():
    assert digest.parse_recipients("a@x.com; b@x.com ,a@x.com,") == ["a@x.com", "b@x.com"]
    assert digest.parse_recipients([" a@x.com ", "", "A@x.com"]) == ["a@x.com"]
    assert digest.parse_recipients("") == []
    assert digest.parse_recipients(None) == []


def test_build_digest_subject_and_content():
    config = _config()
    tenders = [_tender(), _tender(project_id="P2", name="Audit firm", smart_ziw_verdict="NO-GO", smart_ziw_status="completed")]
    subject, text, html = digest.build_digest(config, tenders, now=datetime(2026, 9, 6, 8, 0, tzinfo=timezone.utc))

    assert subject.startswith("SmartZiw digest: 2 new tenders (2026-09-06 08:00 UTC)")
    assert "Firewall procurement" in text
    assert "World Bank | Niger" in text
    assert "Smart-Ziw: GO" in text
    assert "http://server:8080/#/tenders/abc123" in text
    assert "Smart-Ziw: NO-GO" in text
    assert "Firewall procurement" in html
    assert "http://server:8080/#dashboard" in html


def test_build_digest_escapes_html():
    config = _config()
    tenders = [_tender(name="<script>alert(1)</script>")]
    _, _, html = digest.build_digest(config, tenders, now=datetime(2026, 9, 6, tzinfo=timezone.utc))
    assert "<script>" not in html
    assert "&lt;script&gt;" in html


def test_build_digest_truncates_long_lists():
    config = _config()
    tenders = [_tender(project_id=f"P{i}", name=f"Tender {i}") for i in range(60)]
    subject, text, _ = digest.build_digest(config, tenders, now=datetime(2026, 9, 6, tzinfo=timezone.utc))
    assert "60 new tenders" in subject
    assert "and 10 more" in text


def test_send_digest_skips_without_tenders_recipients_or_host():
    assert digest.send_digest(_config(), [])["sent"] is False
    assert digest.send_digest(_config(digest_recipients=[]), [_tender()])["sent"] is False
    assert digest.send_digest(_config(smtp_host=""), [_tender()])["sent"] is False


def test_send_digest_sends_multipart_to_all_recipients(monkeypatch):
    sent = {}

    class FakeSMTP:
        def __init__(self, host, port, timeout=None):
            sent["conn"] = (host, port)

        def ehlo(self):
            pass

        def starttls(self):
            sent["tls"] = True

        def login(self, user, password):
            sent["login"] = (user, password)

        def sendmail(self, from_addr, recipients, message):
            sent["from"] = from_addr
            sent["recipients"] = recipients
            sent["message"] = message

        def quit(self):
            pass

    import smtplib

    monkeypatch.setattr(smtplib, "SMTP", FakeSMTP)
    result = digest.send_digest(_config(), [_tender()])
    assert result["sent"] is True
    assert sent["conn"] == ("smtp.example.com", 587)
    assert sent["tls"] is True
    assert sent["login"] == ("u", "p")
    assert sent["from"] == "smartziw@example.com"
    assert sent["recipients"] == ["a@example.com", "b@example.com"]
    assert "SmartZiw digest: 1 new tender" in sent["message"]
    assert "Content-Type: multipart/alternative" in sent["message"]


def test_send_digest_uses_ssl_for_port_465(monkeypatch):
    sent = {}

    class FakeSMTPSSL:
        def __init__(self, host, port, timeout=None):
            sent["ssl"] = (host, port)

        def ehlo(self):
            pass

        def login(self, user, password):
            pass

        def sendmail(self, from_addr, recipients, message):
            sent["ok"] = True

        def quit(self):
            pass

    import smtplib

    monkeypatch.setattr(smtplib, "SMTP_SSL", FakeSMTPSSL)
    result = digest.send_digest(_config(smtp_port=465), [_tender()])
    assert result["sent"] is True
    assert sent["ssl"] == ("smtp.example.com", 465)
    assert sent.get("ok") is True
