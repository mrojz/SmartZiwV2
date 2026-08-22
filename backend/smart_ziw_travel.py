"""Travel-cost estimator for Smart-Ziw.

Provides rough budget figures for consultants travelling from Tunisia to the
tender country. Estimates are deliberately conservative best-effort ranges;
they should be replaced with real quotes before bidding.
"""

from typing import Callable

# Regional groupings (country names lowercased).
_REGIONS = {
    "north_africa": {
        "tunisia", "morocco", "algeria", "libya", "egypt", "mauritania",
    },
    "europe": {
        "albania", "andorra", "austria", "belgium", "bosnia and herzegovina",
        "bulgaria", "croatia", "cyprus", "czech republic", "czechia", "denmark",
        "estonia", "finland", "france", "germany", "greece", "hungary",
        "iceland", "ireland", "italy", "latvia", "liechtenstein", "lithuania",
        "luxembourg", "malta", "moldova", "monaco", "montenegro", "netherlands",
        "north macedonia", "norway", "poland", "portugal", "romania", "serbia",
        "slovakia", "slovenia", "spain", "sweden", "switzerland", "ukraine",
        "united kingdom", "uk", "vatican",
    },
    "mena": {
        "bahrain", "iran", "iraq", "israel", "jordan", "kuwait", "lebanon",
        "oman", "palestine", "qatar", "saudi arabia", "syria", "united arab emirates",
        "uae", "yemen",
    },
    "subsaharan_africa": {
        "angola", "benin", "botswana", "burkina faso", "burundi", "cameroon",
        "cape verde", "central african republic", "chad", "comoros", "congo",
        "democratic republic of the congo", "djibouti", "equatorial guinea",
        "eritrea", "eswatini", "ethiopia", "gabon", "gambia", "ghana", "guinea",
        "guinea-bissau", "ivory coast", "côte d'ivoire", "kenya", "lesotho",
        "liberia", "madagascar", "malawi", "mali", "mauritius", "mozambique",
        "namibia", "niger", "nigeria", "rwanda", "sao tome and principe",
        "senegal", "seychelles", "sierra leone", "somalia", "south africa",
        "south sudan", "sudan", "tanzania", "togo", "uganda", "zambia", "zimbabwe",
    },
    "asia_pacific": {
        "afghanistan", "australia", "bangladesh", "bhutan", "brunei", "cambodia",
        "china", "hong kong", "india", "indonesia", "japan", "kazakhstan",
        "kyrgyzstan", "laos", "macau", "malaysia", "maldives", "mongolia",
        "myanmar", "nepal", "new zealand", "north korea", "pakistan", "papua new guinea",
        "philippines", "singapore", "south korea", "sri lanka", "taiwan",
        "tajikistan", "thailand", "timor-leste", "turkmenistan", "uzbekistan",
        "vietnam",
    },
    "north_america": {
        "canada", "mexico", "united states", "usa", "us",
    },
    "south_america": {
        "argentina", "bolivia", "brazil", "chile", "colombia", "ecuador",
        "guyana", "paraguay", "peru", "suriname", "uruguay", "venezuela",
    },
}

_FLIGHT_RANGES = {
    "north_africa": (150, 450),
    "europe": (250, 700),
    "mena": (250, 650),
    "subsaharan_africa": (400, 950),
    "asia_pacific": (700, 1500),
    "north_america": (800, 1600),
    "south_america": (1000, 1900),
}

_HOTEL_PER_NIGHT_USD = (45, 75)
_ALLOWANCE_EUR_PER_DAY_PER_CONSULTANT = 50
_USD_PER_EUR_APPROX = 1.10


def _region_for_country(country_name: str) -> str:
    target = (country_name or "").strip().lower()
    for region, countries in _REGIONS.items():
        if target in countries:
            return region
    return "subsaharan_africa" if "africa" in target else "asia_pacific"


def estimate_travel(
    country_name: str,
    duration_days: int = 5,
    consultants: int = 2,
    llm_call: Callable[[str, str], dict] | None = None,
) -> dict:
    """Return a rough travel budget from Tunisia.

    Returns a dict with keys:
      - flight_usd (int): one round-trip ticket estimate per consultant
      - hotel_usd (int): total hotel estimate for the trip
      - allowance_eur (int): per-diem estimate in EUR
      - total_usd (int): rough all-in USD estimate
      - notes (str)
    """
    if not country_name:
        return {
            "flight_usd": 0,
            "hotel_usd": 0,
            "allowance_eur": 0,
            "total_usd": 0,
            "notes": "No destination country provided.",
        }

    region = _region_for_country(country_name)
    flight_low, flight_high = _FLIGHT_RANGES.get(region, (500, 1200))
    flight_per_consultant = round((flight_low + flight_high) / 2)
    flight_total = flight_per_consultant * max(1, consultants)

    hotel_low, hotel_high = _HOTEL_PER_NIGHT_USD
    hotel_total = round((hotel_low + hotel_high) / 2) * max(1, duration_days) * max(1, consultants)

    allowance_eur = _ALLOWANCE_EUR_PER_DAY_PER_CONSULTANT * max(1, duration_days) * max(1, consultants)
    allowance_usd = round(allowance_eur * _USD_PER_EUR_APPROX)

    total_usd = flight_total + hotel_total + allowance_usd

    notes = (
        f"Regional estimate for {country_name.strip()} ({region}) from Tunisia: "
        f"{consultants} consultant(s), {duration_days} day(s). "
        "Figures are indicative only."
    )

    return {
        "flight_usd": flight_total,
        "hotel_usd": hotel_total,
        "allowance_eur": allowance_eur,
        "total_usd": total_usd,
        "notes": notes,
    }
