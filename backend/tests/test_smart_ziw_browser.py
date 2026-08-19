import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import smart_ziw_browser as browser


def _make_response(json_data=None, status_code=200, text=""):
    response = MagicMock()
    response.status_code = status_code
    response.json.return_value = json_data or {}
    response.text = text
    return response


def test_temp_mail_client_creates_account_and_token():
    fake_session = MagicMock()
    responses = [
        _make_response({"hydra:member": [{"domain": "example.com"}]}),
        _make_response({"id": "acc1", "address": "a@example.com"}),
        _make_response({"token": "tok123"}),
    ]
    fake_session.get.side_effect = [responses[0]]
    fake_session.post.side_effect = responses[1:]

    with patch("requests.Session", return_value=fake_session):
        client = browser.TempMailClient()
        address = client.create_account()

    assert address.endswith("@example.com")
    assert client.token == "tok123"
    fake_session.post.assert_any_call(
        "https://api.mail.tm/token",
        json={"address": address, "password": client.password},
        timeout=20,
    )


def test_temp_mail_client_extracts_confirmation_link():
    message = {
        "subject": "Confirm your account",
        "text": "Please confirm by clicking https://example.com/confirm?token=abc123",
        "html": '<a href="https://example.com/confirm?token=abc123">Confirm</a>',
    }
    link = browser.TempMailClient.extract_confirmation_link(message)
    assert link == "https://example.com/confirm?token=abc123"


def test_temp_mail_client_waits_for_message():
    fake_session = MagicMock()
    message = {"id": "m1", "subject": "Welcome"}
    fake_session.get.side_effect = [
        _make_response({"hydra:member": [{"id": "m1"}]}),
        _make_response(message),
    ]

    with patch("requests.Session", return_value=fake_session):
        client = browser.TempMailClient()
        client.token = "tok"
        result = client.wait_for_message(timeout=1, poll_interval=0)

    assert result == message
    fake_session.get.assert_any_call(
        "https://api.mail.tm/messages",
        headers={"Authorization": "Bearer tok"},
        timeout=20,
    )


def test_registering_fetcher_refuses_unsafe_url():
    path, error = browser.fetch_with_tempmail("http://192.168.1.1/file.pdf", Path("/tmp/file.pdf"))
    assert path is None
    assert "blocked" in error


def test_registering_fetcher_skips_when_no_form():
    """When the page has no email+password form, the fetcher reports no registration form."""
    page = MagicMock()
    page.locator.return_value.count.return_value = 0

    fake_context = MagicMock()
    fake_context.new_page.return_value = page
    fake_browser = MagicMock()
    fake_browser.new_context.return_value = fake_context
    fake_playwright = MagicMock()
    fake_playwright.chromium.launch.return_value = fake_browser

    with patch.object(browser.sync_playwright, "__call__", return_value=fake_playwright):
        fetcher = browser.RegisteringFetcher()
        path, error = fetcher.fetch("https://example.com/doc.pdf", Path("/tmp/doc.pdf"))

    assert path is None
    assert "no registration form detected" in error
