"""GitLab mirror pusher for Smart-Ziw tender folders.

Mirrors the generated tender folder to a GitLab repository using a short-lived
HTTP Authorization header for authentication. The token never touches
.git/config, argv, or git output.
"""

import base64
import os
import subprocess
import urllib.parse
from pathlib import Path

import requests


def _preflight_gitlab_api(base_url: str, project_path: str, token: str) -> tuple[bool, str]:
    """Verify the token and project before attempting a git push.

    Returns (ok, message). On failure the message is safe to show to the user.
    """
    api_url = f"{base_url}/api/v4/projects/{urllib.parse.quote(project_path, safe='')}"
    try:
        resp = requests.get(
            api_url,
            headers={"Private-Token": token},
            timeout=10,
        )
    except requests.RequestException as exc:
        return False, f"Could not reach GitLab API ({api_url}): {exc}"

    if resp.status_code == 200:
        return True, "GitLab API connection OK"
    if resp.status_code == 401:
        return False, "GitLab token is invalid or expired"
    if resp.status_code == 403:
        return False, "GitLab token does not have access to this project"
    if resp.status_code == 404:
        return False, f"GitLab project '{project_path}' not found"
    return False, f"GitLab API returned HTTP {resp.status_code}"


def push_to_gitlab(repo_path: Path, folder: str, config: dict) -> dict:
    """Commit and push ``folder`` to the configured GitLab repository.

    Returns {"pushed": bool, "message": str}.
    """
    if not config.get("gitlab_push_enabled"):
        return {"pushed": False, "message": "GitLab push disabled"}

    base_url = (config.get("gitlab_base_url") or "").rstrip("/")
    project_path = (config.get("gitlab_project_path") or "").strip("/")
    token = config.get("gitlab_token", "")
    branch = config.get("gitlab_branch", "main")
    author_name = config.get("gitlab_author_name", "Smart-Ziw Agent")
    author_email = config.get("gitlab_author_email", "smart-ziw@localhost")

    if not all([base_url, project_path, token]):
        return {"pushed": False, "message": "GitLab config incomplete"}

    if project_path.endswith(".git"):
        project_path = project_path[:-4]
    push_url = f"{base_url}/{project_path}.git"

    # GitLab HTTP basic auth: username "oauth2", password the personal token.
    credentials = base64.b64encode(f"oauth2:{token}".encode()).decode()
    auth_header = f"Authorization: Basic {credentials}"

    ok, msg = _preflight_gitlab_api(base_url, project_path, token)
    if not ok:
        return {"pushed": False, "message": f"GitLab connection check failed: {msg}"}

    def _scrub(text: str) -> str:
        text = (text or "").replace(token, "***")
        text = text.replace(credentials, "***")
        return text

    def _git(args, check=True, auth=False):
        env = os.environ.copy()
        if auth:
            # http.extraheader via env config — not persisted anywhere.
            env.update({
                "GIT_CONFIG_COUNT": "1",
                "GIT_CONFIG_KEY_0": "http.extraheader",
                "GIT_CONFIG_VALUE_0": auth_header,
            })
        return subprocess.run(
            ["git"] + args,
            cwd=str(repo_path),
            check=check,
            capture_output=True,
            text=True,
            env=env,
        )

    try:
        if not (repo_path / ".git").exists():
            _git(["init"], check=False)
        _git(["config", "user.name", author_name], check=False)
        _git(["config", "user.email", author_email], check=False)
        _git(["add", "--", f"{folder}/"], check=True)
        if (repo_path / folder / "documents").exists():
            # Tender binaries are kept locally but excluded from the mirror.
            _git(["rm", "-r", "--cached", "--quiet", "--", f"{folder}/documents"], check=False)
        status = _git(["status", "--porcelain"], check=False)
        if not status.stdout.strip():
            return {"pushed": False, "message": "No changes to commit"}
        _git(["commit", "-m", f"smart-ziw: add/update {folder}"])
        push = _git(["push", push_url, f"HEAD:{branch}"], auth=True)
        return {"pushed": True, "message": _scrub(push.stdout or "Pushed successfully")}
    except subprocess.CalledProcessError as exc:
        return {"pushed": False, "message": _scrub(f"Git error: {exc.stderr or exc.stdout}")}
    except FileNotFoundError:
        return {"pushed": False, "message": "Git is not installed or not available in PATH"}
