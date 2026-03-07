import json
import re
import unicodedata
from functools import lru_cache
from pathlib import Path

DATA_PATH = Path(__file__).resolve().parent / 'data' / 'geography_seed.json'

COUNTRY_ALIAS_OVERRIDES = {
    'CD': ['dem rep congo', 'dem. rep. congo', 'dr congo', 'rd congo', 'drc', 'republique democratique du congo', 'r?publique d?mocratique du congo', 'congo kinshasa'],
    'CG': ['republic of the congo', 'rep congo', 'congo brazzaville', 'r?publique du congo'],
    'CI': ['ivory coast', "cote d'ivoire", 'cote d ivoire', 'c?te d?ivoire', 'c?te d ivoire'],
    'CV': ['cape verde'],
    'CZ': ['czech republic'],
    'GM': ['the gambia'],
    'KR': ['south korea', 'republic of korea'],
    'KP': ['north korea', 'democratic people s republic of korea'],
    'LA': ['laos', 'lao pdr'],
    'MK': ['north macedonia', 'macedonia'],
    'MM': ['burma'],
    'MD': ['moldova', 'republic of moldova'],
    'PS': ['palestine', 'state of palestine'],
    'RU': ['russia', 'russian federation'],
    'ST': ['sao tome and principe', 'sao tome & principe'],
    'SZ': ['swaziland'],
    'TL': ['east timor', 'timor leste'],
    'TR': ['turkey', 'turkiye'],
    'TZ': ['tanzania', 'united republic of tanzania'],
    'US': ['usa', 'u s a', 'united states', 'united states of america'],
    'VE': ['venezuela', 'venezuela bolivarian republic of'],
}

CONTINENT_ALIASES = {
    'AF': ['africa', 'afrique'],
    'EU': ['europe', 'eu 27', 'eu27', 'european union', 'union europeenne', 'union europ?enne'],
    'AS': ['asia', 'asie'],
    'NA': ['north america', 'northern america', 'amerique du nord', 'am?rique du nord'],
    'SA': ['south america', 'latin america', 'amerique du sud', 'am?rique du sud', 'amerique latine', 'am?rique latine'],
    'OC': ['oceania', 'oceanie', 'oc?anie', 'pacific', 'pacifique'],
}

TOKEN_SPLIT_RE = re.compile(r'[,;/|]+')


def normalize_text(value: str) -> str:
    text = unicodedata.normalize('NFKD', str(value or ''))
    text = ''.join(ch for ch in text if not unicodedata.combining(ch))
    text = text.lower().replace('&', ' and ')
    text = re.sub(r"[^a-z0-9]+", ' ', text)
    return re.sub(r'\s+', ' ', text).strip()


@lru_cache(maxsize=1)
def load_seed_data() -> dict:
    return json.loads(DATA_PATH.read_text(encoding='utf-8'))


def build_region_name_map(seed_data: dict | None = None) -> dict[str, list[str]]:
    data = seed_data or load_seed_data()
    countries_by_iso = {country['iso2']: country['name_en'] for country in data.get('countries', [])}
    region_map = {}
    for region in data.get('regions', []):
        region_map[region['name']] = [countries_by_iso[iso] for iso in region.get('country_iso2s', []) if iso in countries_by_iso]
    return region_map


def _build_country_alias_map(countries: list[dict]) -> dict[str, str]:
    alias_map: dict[str, str] = {}
    for country in countries:
        iso2 = country['iso2']
        aliases = {country.get('name_en', ''), country.get('name_fr', '')}
        aliases.update(COUNTRY_ALIAS_OVERRIDES.get(iso2, []))
        for alias in aliases:
            normalized = normalize_text(alias)
            if normalized and normalized not in alias_map:
                alias_map[normalized] = iso2
    return alias_map


def _build_continent_alias_map(continents: list[dict]) -> dict[str, str]:
    alias_map: dict[str, str] = {}
    for continent in continents:
        code = continent['code']
        aliases = {continent.get('name_en', ''), continent.get('name_fr', '')}
        aliases.update(CONTINENT_ALIASES.get(code, []))
        for alias in aliases:
            normalized = normalize_text(alias)
            if normalized:
                alias_map[normalized] = code
    return alias_map


def build_lookup(geography: dict) -> dict:
    continents = geography.get('continents', [])
    countries = geography.get('countries', [])
    regions = geography.get('regions', [])
    countries_by_iso = {country['iso2']: country for country in countries}
    continents_by_code = {continent['code']: continent for continent in continents}
    return {
        'countries_by_iso': countries_by_iso,
        'continents_by_code': continents_by_code,
        'regions': regions,
        'country_aliases': _build_country_alias_map(countries),
        'continent_aliases': _build_continent_alias_map(continents),
    }


def infer_project_geography(project: dict, geography: dict) -> dict:
    lookup = build_lookup(geography)
    source_text = ' | '.join(
        str(project.get(key, '') or '')
        for key in ('project_country', 'country', 'project_sponsor')
    ).strip()
    if not source_text:
        return {
            'country_iso2s': [],
            'country_names_en': [],
            'country_names_fr': [],
            'continent_codes': [],
            'continent_names_en': [],
            'continent_names_fr': [],
            'region_slugs': [],
            'region_names': [],
        }

    normalized_tokens = [normalize_text(token) for token in TOKEN_SPLIT_RE.split(source_text)]
    normalized_tokens = [token for token in normalized_tokens if token]
    haystack = normalize_text(source_text)

    matched_country_iso2s: list[str] = []
    for token in normalized_tokens:
        iso2 = lookup['country_aliases'].get(token)
        if iso2 and iso2 not in matched_country_iso2s:
            matched_country_iso2s.append(iso2)

    if not matched_country_iso2s:
        for alias, iso2 in sorted(lookup['country_aliases'].items(), key=lambda item: len(item[0]), reverse=True):
            if len(alias) < 4:
                continue
            if alias in haystack and iso2 not in matched_country_iso2s:
                matched_country_iso2s.append(iso2)

    matched_continent_codes = []
    for token in normalized_tokens:
        continent_code = lookup['continent_aliases'].get(token)
        if continent_code and continent_code not in matched_continent_codes:
            matched_continent_codes.append(continent_code)

    for iso2 in matched_country_iso2s:
        continent_code = lookup['countries_by_iso'].get(iso2, {}).get('continent_code')
        if continent_code and continent_code not in matched_continent_codes:
            matched_continent_codes.append(continent_code)

    matched_region_slugs = []
    matched_region_names = []
    matched_country_set = set(matched_country_iso2s)
    for region in lookup['regions']:
        region_country_set = set(region.get('country_iso2s', []))
        if matched_country_set and matched_country_set.intersection(region_country_set):
            matched_region_slugs.append(region['slug'])
            matched_region_names.append(region['name'])

    countries = [lookup['countries_by_iso'][iso2] for iso2 in matched_country_iso2s if iso2 in lookup['countries_by_iso']]
    continents = [lookup['continents_by_code'][code] for code in matched_continent_codes if code in lookup['continents_by_code']]

    return {
        'country_iso2s': matched_country_iso2s,
        'country_names_en': [country['name_en'] for country in countries],
        'country_names_fr': [country['name_fr'] for country in countries],
        'continent_codes': matched_continent_codes,
        'continent_names_en': [continent['name_en'] for continent in continents],
        'continent_names_fr': [continent['name_fr'] for continent in continents],
        'region_slugs': matched_region_slugs,
        'region_names': matched_region_names,
    }
