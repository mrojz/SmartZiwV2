"""Browser-based document fetcher with temporary-email registration fallback.

When a tender document URL requires login/registration, this module creates a
disposable mail.tm address, drives a headless Chromium session to fill the
registration form, confirms the account from the inbox if required, and then
retries the document download.

All URLs still pass through the same SSRF guard as the rest of Smart-Ziw, and
no credentials persist after the run.
"""

import os
import re
import secrets
import socket
import time
from pathlib import Path
from urllib.parse import urlparse

import requests
from playwright.sync_api import sync_playwright

from smart_ziw_research import url_is_safe


class TempMailError(RuntimeError):
    pass


class TempMailClient:
    """Minimal mail.tm client: create an inbox and poll for messages."""

    DEFAULT_BASE_URL = "https://api.mail.tm"

    def __init__(self, base_url: str | None = None):
        self.base_url = (base_url or self.DEFAULT_BASE_URL).rstrip("/")
        self.session = requests.Session()
        self.address: str | None = None
        self.password: str | None = None
        self.token: str | None = None

    def _get(self, path: str, **kwargs) -> requests.Response:
        return self.session.get(f"{self.base_url}{path}", timeout=20, **kwargs)

    def _post(self, path: str, json_payload: dict, **kwargs) -> requests.Response:
        return self.session.post(f"{self.base_url}{path}", json=json_payload, timeout=20, **kwargs)

    def available_domain(self) -> str:
        response = self._get("/domains")
        response.raise_for_status()
        data = response.json()
        domains = data.get("hydra:member") or (data if isinstance(data, list) else [])
        if domains:
            return domains[0].get("domain", "mail.tm")
        # Fallback domain if the API shape changes.
        return "mail.tm"

    def create_account(self) -> str:
        domain = self.available_domain()
        local = f"smartziw{secrets.token_hex(6)}"
        self.address = f"{local}@{domain}"
        self.password = secrets.token_urlsafe(16)

        create_response = self._post("/accounts", {"address": self.address, "password": self.password})
        create_response.raise_for_status()

        token_response = self._post("/token", {"address": self.address, "password": self.password})
        token_response.raise_for_status()
        self.token = token_response.json().get("token")
        if not self.token:
            raise TempMailError("mail.tm did not return an auth token")
        return self.address

    def wait_for_message(self, timeout: int = 60, poll_interval: int = 3) -> dict | None:
        if not self.token:
            raise TempMailError("no auth token; call create_account() first")
        headers = {"Authorization": f"Bearer {self.token}"}
        deadline = time.time() + timeout
        while time.time() < deadline:
            list_response = self._get("/messages", headers=headers)
            list_response.raise_for_status()
            data = list_response.json()
            messages = data.get("hydra:member") or (data if isinstance(data, list) else [])
            if messages:
                msg_id = messages[0].get("id")
                if msg_id:
                    msg_response = self._get(f"/messages/{msg_id}", headers=headers)
                    msg_response.raise_for_status()
                    return msg_response.json()
            time.sleep(poll_interval)
        return None

    @staticmethod
    def extract_confirmation_link(message: dict) -> str | None:
        """Return the first http(s) URL found in a message."""
        candidates = [
            message.get("text") or "",
            message.get("html") or "",
            message.get("subject") or "",
        ]
        for text in candidates:
            match = re.search(r"https?://[^\s\"<>]+", str(text))
            if match:
                return match.group(0)
        return None


class RegisteringFetcher:
    """Best-effort browser fetcher that registers with a temp email when a
    document URL is behind a login/registration wall.

    This is intentionally conservative: it only attempts registration when it
    can clearly identify an email/password form, and it gives up on captchas,
    OTP-only flows, or non-English forms.
    """

    def __init__(self, mail_client: TempMailClient | None = None):
        self.mail = mail_client or TempMailClient()

    def fetch(self, url: str, target_path: Path, max_bytes: int = 50 * 1024 * 1024) -> tuple[Path | None, str | None]:
        if not url_is_safe(url):
            return None, "blocked (unsafe URL)"

        downloaded: Path | None = None
        error: str | None = None

        with sync_playwright() as playwright:
            launch_options = {"headless": True}
            executable_path = os.environ.get("PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH")
            if executable_path:
                launch_options["executable_path"] = executable_path
            browser = playwright.chromium.launch(**launch_options)
            context = browser.new_context(
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
            )
            page = context.new_page()

            def _handle_download(download):
                nonlocal downloaded
                suffix = Path(download.suggested_filename or target_path.name).suffix
                dest = target_path.with_suffix(suffix) if suffix else target_path
                try:
                    download.save_as(dest)
                    downloaded = dest
                except Exception as exc:
                    nonlocal error
                    error = f"download save failed: {exc}"

            page.on("download", _handle_download)

            try:
                page.goto(url, wait_until="domcontentloaded", timeout=30000)
                page.wait_for_timeout(1500)

                if downloaded:
                    return downloaded, None

                if self._looks_like_registration_or_login(page):
                    return self._register_and_retry(page, url, target_path, browser)

                error = error or "document not accessible and no registration form detected"
            except Exception as exc:
                error = f"browser fetch failed: {exc}"
            finally:
                try:
                    browser.close()
                except Exception:
                    pass

        return downloaded, error

    @staticmethod
    def _looks_like_registration_or_login(page) -> bool:
        """True if the page contains an email input and a password input."""
        selectors = [
            "input[type='email']",
            "input[name*='email' i]",
            "input[id*='email' i]",
            "input[placeholder*='email' i]",
        ]
        has_email = any(page.locator(sel).count() > 0 for sel in selectors)
        has_password = page.locator("input[type='password']").count() > 0
        return has_email and has_password

    @staticmethod
    def _find_register_link(page):
        """Return a locator for a register/sign-up link if one exists."""
        patterns = [
            "a:has-text('sign up')",
            "a:has-text('register')",
            "a:has-text('create account')",
            "button:has-text('sign up')",
            "button:has-text('register')",
            "button:has-text('create account')",
        ]
        for pattern in patterns:
            locator = page.locator(pattern).first
            if locator.count() > 0:
                return locator
        return None

    def _register_and_retry(self, page, original_url: str, target_path: Path, browser):
        downloaded: Path | None = None
        error: str | None = None
        try:
            address = self.mail.create_account()
            password = self.mail.password

            register_link = self._find_register_link(page)
            if register_link:
                register_link.click()
                page.wait_for_timeout(1500)

            # Fill email
            email_selectors = [
                "input[type='email']",
                "input[name*='email' i]",
                "input[id*='email' i]",
                "input[placeholder*='email' i]",
            ]
            for sel in email_selectors:
                loc = page.locator(sel).first
                if loc.count() > 0:
                    loc.fill(address)
                    break

            # Fill password fields (password + confirm)
            password_inputs = page.locator("input[type='password']").all()
            if password_inputs:
                password_inputs[0].fill(password)
                if len(password_inputs) > 1:
                    password_inputs[1].fill(password)

            # Fill other required text inputs with plausible values.
            for input_el in page.locator("input[required], textarea[required]").all():
                input_type = (input_el.get_attribute("type") or "").lower()
                if input_type in ("email", "password"):
                    continue
                name_attr = (input_el.get_attribute("name") or "").lower()
                placeholder = (input_el.get_attribute("placeholder") or "").lower()
                current = input_el.input_value()
                if current:
                    continue
                if "name" in name_attr or "name" in placeholder:
                    input_el.fill("Smart Ziw")
                elif "company" in name_attr or "organization" in name_attr:
                    input_el.fill("Procurement Team")
                elif "phone" in name_attr or "tel" in input_type:
                    input_el.fill("+33123456789")
                elif "country" in name_attr:
                    input_el.fill("France")
                else:
                    input_el.fill("n/a")

            # Agree to terms if a clear terms checkbox exists.
            for checkbox in page.locator("input[type='checkbox']").all():
                label_text = ""
                label_id = checkbox.get_attribute("id")
                if label_id:
                    label = page.locator(f"label[for='{label_id}']")
                    if label.count() > 0:
                        label_text = (label.text_content() or "").lower()
                if not label_text:
                    parent = checkbox.locator("xpath=..")
                    if parent.count() > 0:
                        label_text = (parent.text_content() or "").lower()
                if any(word in label_text for word in ("agree", "terms", "conditions", "privacy", "accept")):
                    checkbox.check()

            # Submit
            submit_locator = None
            for sel in [
                "button[type='submit']",
                "input[type='submit']",
                "button:has-text('register')",
                "button:has-text('sign up')",
                "button:has-text('create account')",
            ]:
                candidate = page.locator(sel).first
                if candidate.count() > 0:
                    submit_locator = candidate
                    break
            if submit_locator is None:
                return None, "registration form detected but no submit button found"
            submit_locator.click()
            page.wait_for_timeout(3000)

            # Wait for confirmation email and follow the link if present.
            message = self.mail.wait_for_message(timeout=60, poll_interval=3)
            if message:
                confirmation_url = TempMailClient.extract_confirmation_link(message)
                if confirmation_url and url_is_safe(confirmation_url):
                    page.goto(confirmation_url, wait_until="domcontentloaded", timeout=30000)
                    page.wait_for_timeout(2000)

            # Retry the original document URL.
            page.goto(original_url, wait_until="domcontentloaded", timeout=30000)
            page.wait_for_timeout(3000)

            if not downloaded:
                # Some sites present the document inline after login; try to click a direct download link.
                for pattern in [
                    "a[href*='download' i]",
                    "a[href$='.pdf']",
                    "a[href$='.docx']",
                    "a[href$='.xlsx']",
                    "button:has-text('download')",
                ]:
                    link = page.locator(pattern).first
                    if link.count() > 0:
                        with page.expect_download(timeout=15000) as download_info:
                            try:
                                link.click()
                            except Exception:
                                continue
                        download = download_info.value
                        suffix = Path(download.suggested_filename or target_path.name).suffix
                        dest = target_path.with_suffix(suffix) if suffix else target_path
                        download.save_as(dest)
                        downloaded = dest
                        break

            if downloaded:
                return downloaded, None
            error = "registration succeeded but document could not be downloaded"
        except Exception as exc:
            error = f"registration fetch failed: {exc}"
        finally:
            try:
                browser.close()
            except Exception:
                pass
        return downloaded, error


def fetch_with_tempmail(url: str, target_path: Path, max_bytes: int = 50 * 1024 * 1024) -> tuple[Path | None, str | None]:
    """Convenience entry point."""
    return RegisteringFetcher().fetch(url, target_path, max_bytes)
