"""Template loader/filler for the Smart-Ziw tender folder spec.

Loads the official markdown templates from the agents spec directory and
exposes helpers to retrieve or fill them with project context.
"""

from pathlib import Path

import jinja2

TEMPLATES_DIR = Path("/home/kali/smartZiw/Smart-Ziw/agents/Smart-Ziw/templates")

_TEMPLATE_FILES = {
    "source": "source.template.md",
    "analysis": "analysis.template.md",
    "eligibility": "eligibility.template.md",
    "risks": "risks.template.md",
    "pricing": "pricing.template.md",
    "recap": "recap.template.md",
    "documents.notes": "documents.notes.template.md",
    "README": "README.template.md",
}


def _load_templates() -> dict[str, str]:
    loaded: dict[str, str] = {}
    for name, rel in _TEMPLATE_FILES.items():
        path = TEMPLATES_DIR / rel
        try:
            loaded[name] = path.read_text(encoding="utf-8")
        except Exception:
            loaded[name] = ""
    return loaded


_TEMPLATES = _load_templates()
_JINJA_ENV = jinja2.Environment(
    loader=jinja2.BaseLoader(),
    autoescape=False,
    undefined=jinja2.Undefined,
)


def get_template(name: str) -> str:
    """Return the raw template text for ``name``."""
    return _TEMPLATES.get(name, "")


def fill_template(name: str, context: dict) -> str:
    """Fill template ``name`` with ``context``.

    Missing variables render as empty strings.
    """
    template_text = get_template(name)
    if not template_text:
        return ""
    template = _JINJA_ENV.from_string(template_text)
    safe_context = {k: "" if v is None else v for k, v in context.items()}
    return template.render(**safe_context)
