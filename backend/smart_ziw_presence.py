"""Forvis Mazars in-country presence checker for Smart-Ziw.

The primary source is a configurable static list of countries where Forvis
Mazars / Mazars has an office. The list can be overridden through the
``forvis_mazars_presence_countries`` config key.
"""

from difflib import get_close_matches
from typing import Iterable

# Initial office-country list based on publicly known Forvis Mazars / Mazars
# locations. It is intentionally conservative: a country not on the list is
# treated as "not confirmed" rather than "absent".
DEFAULT_FORVIS_MAZARS_COUNTRIES = [
    "Algeria",
    "Argentina",
    "Australia",
    "Austria",
    "Bahrain",
    "Belgium",
    "Brazil",
    "Bulgaria",
    "Cameroon",
    "Canada",
    "Chile",
    "China",
    "Colombia",
    "Croatia",
    "Cyprus",
    "Czech Republic",
    "Democratic Republic of the Congo",
    "Egypt",
    "France",
    "Germany",
    "Ghana",
    "Greece",
    "Hong Kong",
    "Hungary",
    "India",
    "Indonesia",
    "Ireland",
    "Israel",
    "Italy",
    "Ivory Coast",
    "Japan",
    "Jordan",
    "Kenya",
    "Kuwait",
    "Lebanon",
    "Luxembourg",
    "Malaysia",
    "Malta",
    "Mexico",
    "Morocco",
    "Netherlands",
    "New Zealand",
    "Nigeria",
    "Norway",
    "Oman",
    "Peru",
    "Philippines",
    "Poland",
    "Portugal",
    "Qatar",
    "Romania",
    "Saudi Arabia",
    "Senegal",
    "Serbia",
    "Singapore",
    "Slovakia",
    "Slovenia",
    "South Africa",
    "South Korea",
    "Spain",
    "Sweden",
    "Switzerland",
    "Taiwan",
    "Thailand",
    "Tunisia",
    "Turkey",
    "United Arab Emirates",
    "United Kingdom",
    "United States",
    "Uruguay",
    "Vietnam",
]


def _normalize(country: str) -> str:
    return (country or "").strip().lower()


def has_forvis_mazars_presence(country_name: str, config_countries: Iterable[str] | None = None) -> dict:
    """Return presence information for a tender country.

    Returns a dict with keys:
      - present (bool)
      - evidence (str)
      - confidence ("high" | "medium" | "low")
    """
    target = _normalize(country_name)
    if not target:
        return {
            "present": False,
            "evidence": "No country specified for local presence check.",
            "confidence": "low",
        }

    candidates = list(config_countries or DEFAULT_FORVIS_MAZARS_COUNTRIES)
    normalized_candidates = {c: _normalize(c) for c in candidates}

    # Exact, substring, or word match.
    for original, norm in normalized_candidates.items():
        if target == norm:
            return {
                "present": True,
                "evidence": f"Forvis Mazars has an office in {original}.",
                "confidence": "high",
            }
        if target in norm or norm in target:
            return {
                "present": True,
                "evidence": f"Forvis Mazars has an office in {original} (matched '{country_name}').",
                "confidence": "high",
            }

    # Fuzzy match for typos / alternate names.
    close = get_close_matches(target, normalized_candidates.values(), n=1, cutoff=0.8)
    if close:
        matched_original = next(orig for orig, norm in normalized_candidates.items() if norm == close[0])
        return {
            "present": True,
            "evidence": f"Close match: Forvis Mazars has an office in {matched_original}.",
            "confidence": "medium",
        }

    return {
        "present": False,
        "evidence": f"{country_name} is not on the configured Forvis Mazars office list.",
        "confidence": "medium",
    }
