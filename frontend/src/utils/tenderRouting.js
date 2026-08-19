const API = '/api';

export function getTenderIdFromHash(rawHash = '') {
    const hash = String(rawHash || '').replace(/^#/, '').replace(/^\//, '');
    const match = hash.match(/^tenders\/([^/?#]+)/);
    return match ? decodeURIComponent(match[1]) : '';
}

export function buildTenderHash(projectDbId = '') {
    return projectDbId ? `#/tenders/${encodeURIComponent(projectDbId)}` : '#dashboard';
}

export function buildTenderShareUrl(projectDbId = '') {
    if (!projectDbId || typeof window === 'undefined') return '';
    return `${window.location.origin}${window.location.pathname}${window.location.search}${buildTenderHash(projectDbId)}`;
}

const DEFAULT_FILTERS = {
    q: '',
    source: '',
    region: '',
    continent: '',
    verified: 'Yes',
    decision: '',
    deadlineFrom: '',
    deadlineTo: '',
    scrapedFrom: '',
    scrapedTo: '',
    expiringSoon: '0',
    expiringDays: '5',
};

export function serializeFilters(filters = {}) {
    const params = new URLSearchParams();
    Object.entries(DEFAULT_FILTERS).forEach(([key, defaultValue]) => {
        const value = filters[key];
        if (value !== undefined && String(value) !== String(defaultValue) && String(value) !== '') {
            params.set(key, String(value));
        }
    });
    return params.toString();
}

export function deserializeFilters(search = '') {
    const params = new URLSearchParams(search);
    const result = { ...DEFAULT_FILTERS };
    Object.keys(DEFAULT_FILTERS).forEach((key) => {
        if (params.has(key)) result[key] = params.get(key);
    });
    return result;
}

export function buildDashboardHash(filters = {}) {
    const query = serializeFilters(filters);
    return query ? `#/dashboard?${query}` : '#dashboard';
}
