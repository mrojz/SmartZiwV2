// Filter predicate shared by the tenders list and saved-search match counts.
// `filters` uses the same shape as TendersPage's buildCurrentFilterState().

export function parseFilterDate(value) {
    if (!value) return null;
    const direct = new Date(value);
    if (!Number.isNaN(direct.getTime())) return direct;
    const parts = String(value).split('/');
    if (parts.length === 3) {
        const parsed = new Date(parts[2], parts[0] - 1, parts[1]);
        if (!Number.isNaN(parsed.getTime())) return parsed;
    }
    return null;
}

export function filterProjects(projects, filters = {}, regions = {}) {
    const ft = String(filters.freeText || '').toLowerCase();
    const source = filters.source || '';
    const verified = filters.verified ?? '';
    const region = filters.region || '';
    const continent = filters.continent || '';
    const decision = filters.decision || '';
    const endDateFrom = filters.endDateFrom || '';
    const endDateTo = filters.endDateTo || '';
    const scrapedFrom = filters.scrapedFrom || '';
    const scrapedTo = filters.scrapedTo || '';
    const expiringSoonOnly = Boolean(filters.expiringSoonOnly);
    const expiringSoonDays = Math.max(1, Math.min(365, Number(filters.expiringSoonDays) || 5));
    const chips = Array.isArray(filters.chips) ? filters.chips : [];

    const chipGroups = chips.reduce((acc, chip) => {
        const field = String(chip.field || '').toLowerCase();
        if (!['source', 'region', 'continent', 'country'].includes(field)) return acc;
        if (!acc[field]) acc[field] = [];
        acc[field].push(String(chip.value || '').toLowerCase());
        return acc;
    }, {});
    const deadlineFromDate = endDateFrom ? new Date(endDateFrom) : null;
    const deadlineToDate = endDateTo ? new Date(endDateTo) : null;
    const scrapedFromDate = scrapedFrom ? new Date(scrapedFrom) : null;
    const scrapedToDate = scrapedTo ? new Date(scrapedTo) : null;
    const expiringWindowStart = new Date();
    expiringWindowStart.setHours(0, 0, 0, 0);
    const expiringWindowEnd = new Date(expiringWindowStart);
    expiringWindowEnd.setDate(expiringWindowEnd.getDate() + expiringSoonDays);
    expiringWindowEnd.setHours(23, 59, 59, 999);
    if (deadlineToDate) deadlineToDate.setHours(23, 59, 59, 999);
    if (scrapedToDate) scrapedToDate.setHours(23, 59, 59, 999);

    return projects.filter((p) => {
        if (ft && ![p.project_id, p.project_name, p.project_description, p.project_sponsor].join(' ').toLowerCase().includes(ft)) return false;
        if (source && p.source !== source) return false;
        if (verified && p.ai_verified !== verified) return false;
        const projectRegions = (p.region_names || []).map((name) => String(name).toLowerCase());
        if (region) {
            const regionValue = String(region).toLowerCase();
            const sponsor = (p.project_sponsor || '').toLowerCase();
            const fallbackCountries = (regions[region] || []).map((c) => c.toLowerCase());
            const regionMatch = projectRegions.includes(regionValue) || (fallbackCountries.length > 0 && fallbackCountries.some((c) => sponsor.includes(c)));
            if (!regionMatch) return false;
        }
        if (continent) {
            const continentValue = String(continent).toLowerCase();
            const projectContinents = [
                ...(p.continent_codes || []).map((code) => String(code).toLowerCase()),
                ...(p.continent_names_en || []).map((name) => String(name).toLowerCase()),
                ...(p.continent_names_fr || []).map((name) => String(name).toLowerCase()),
            ];
            if (!projectContinents.includes(continentValue)) return false;
        }
        if (chipGroups.source?.length) {
            const projectSource = String(p.source || '').toLowerCase();
            if (!chipGroups.source.some((value) => projectSource.includes(value))) return false;
        }
        if (chipGroups.region?.length) {
            if (!chipGroups.region.some((value) => projectRegions.includes(value))) return false;
        }
        if (chipGroups.continent?.length) {
            const projectContinents = [
                ...(p.continent_codes || []).map((code) => String(code).toLowerCase()),
                ...(p.continent_names_en || []).map((name) => String(name).toLowerCase()),
                ...(p.continent_names_fr || []).map((name) => String(name).toLowerCase()),
            ];
            if (!chipGroups.continent.some((value) => projectContinents.includes(value))) return false;
        }
        if (chipGroups.country?.length) {
            const projectCountries = [
                ...(p.country_names_en || []).map((name) => String(name).toLowerCase()),
                ...(p.country_names_fr || []).map((name) => String(name).toLowerCase()),
                String(p.project_sponsor || '').toLowerCase(),
            ];
            if (!chipGroups.country.some((value) => projectCountries.some((countryValue) => countryValue.includes(value)))) return false;
        }
        if (decision === 'Undecided' && p.decision) return false;
        if (decision && decision !== 'Undecided' && p.decision !== decision) return false;
        const projectDeadline = parseFilterDate(p.effective_deadline || p.manual_deadline || p.scraped_deadline || p.project_end_date);
        if (deadlineFromDate && (!projectDeadline || projectDeadline < deadlineFromDate)) return false;
        if (deadlineToDate && (!projectDeadline || projectDeadline > deadlineToDate)) return false;
        if (expiringSoonOnly) {
            if (p.ai_verified !== 'Yes') return false;
            if (!projectDeadline || projectDeadline < expiringWindowStart || projectDeadline > expiringWindowEnd) return false;
        }
        const scrapedAt = parseFilterDate(p.scraped_at);
        if (scrapedFromDate && (!scrapedAt || scrapedAt < scrapedFromDate)) return false;
        if (scrapedToDate && (!scrapedAt || scrapedAt > scrapedToDate)) return false;
        return true;
    });
}
