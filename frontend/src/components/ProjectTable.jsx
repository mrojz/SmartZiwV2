import { useState, useMemo } from 'react';

export default function ProjectTable({ projects, allProjects, onDecisionChange, regions }) {
    const [sortCol, setSortCol] = useState(null);
    const [sortDir, setSortDir] = useState('asc'); // 'asc' or 'desc'

    // Build reverse lookup: country → region name
    const countryToRegion = useMemo(() => {
        const map = {};
        Object.entries(regions || {}).forEach(([regionName, countries]) => {
            countries.forEach((c) => {
                map[c.toLowerCase()] = regionName;
            });
        });
        return map;
    }, [regions]);

    const getRegion = (sponsor) => {
        if (!sponsor) return '—';
        const lower = sponsor.toLowerCase();
        for (const [country, region] of Object.entries(countryToRegion)) {
            if (lower.includes(country)) return region;
        }
        return '—';
    };

    // Column definitions: key, label, type
    const columns = [
        { key: 'project_id', label: 'ID', type: 'string' },
        { key: 'project_name', label: 'Name', type: 'string' },
        { key: 'source', label: 'Source', type: 'string' },
        { key: 'project_sponsor', label: 'Sponsor', type: 'string' },
        { key: '_region', label: 'Region', type: 'string' },
        { key: 'project_start_date', label: 'Start', type: 'date' },
        { key: 'project_end_date', label: 'End', type: 'date' },
        { key: 'ai_verified', label: 'AI', type: 'string' },
        { key: 'matched_keywords', label: 'Keywords', type: 'string' },
        { key: '_decision', label: 'Decision', type: 'none' },
        { key: '_links', label: 'Links', type: 'none' },
    ];

    const parseDate = (str) => {
        if (!str) return null;
        // Handle MM/DD/YYYY
        const parts = str.split('/');
        if (parts.length === 3) {
            return new Date(parts[2], parts[0] - 1, parts[1]);
        }
        // Handle YYYY-MM-DD
        const d = new Date(str);
        return isNaN(d) ? null : d;
    };

    const sorted = useMemo(() => {
        if (!sortCol) return projects;
        const col = columns.find((c) => c.key === sortCol);
        if (!col || col.type === 'none') return projects;

        return [...projects].sort((a, b) => {
            let valA, valB;

            if (sortCol === '_region') {
                valA = getRegion(a.project_sponsor);
                valB = getRegion(b.project_sponsor);
            } else {
                valA = a[sortCol] || '';
                valB = b[sortCol] || '';
            }

            let cmp = 0;
            if (col.type === 'date') {
                const dA = parseDate(valA);
                const dB = parseDate(valB);
                cmp = (dA || new Date(0)) - (dB || new Date(0));
            } else {
                cmp = String(valA).localeCompare(String(valB), undefined, { sensitivity: 'base' });
            }

            return sortDir === 'asc' ? cmp : -cmp;
        });
    }, [projects, sortCol, sortDir, countryToRegion]);

    const handleSort = (colKey) => {
        const col = columns.find((c) => c.key === colKey);
        if (!col || col.type === 'none') return;

        if (sortCol === colKey) {
            setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
        } else {
            setSortCol(colKey);
            setSortDir('asc');
        }
    };

    const sortIcon = (colKey) => {
        if (sortCol !== colKey) return ' ↕';
        return sortDir === 'asc' ? ' ↑' : ' ↓';
    };

    return (
        <div className="table-wrapper">
            <table className="projects-table">
                <thead>
                    <tr>
                        {columns.map((col) => (
                            <th
                                key={col.key}
                                className={col.type !== 'none' ? 'sortable-th' : ''}
                                onClick={() => handleSort(col.key)}
                                title={col.type !== 'none' ? `Sort by ${col.label}` : ''}
                            >
                                {col.label}
                                {col.type !== 'none' && (
                                    <span className="sort-indicator">{sortIcon(col.key)}</span>
                                )}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {sorted.map((p, i) => {
                        const realIndex = allProjects.indexOf(p);
                        const isVerified = p.ai_verified === 'Yes';
                        return (
                            <tr key={`${p.project_id}-${i}`} className={p.decision === 'No Go' ? 'row-nogo' : ''}>
                                <td className="td-id">{p.project_id}</td>
                                <td className="td-name">
                                    <span title={p.project_name || p.project_description || '—'}>{p.project_name || p.project_description || '—'}</span>
                                </td>
                                <td>
                                    <span className={`badge badge-source ${sourceClass(p.source)}`}>
                                        {p.source}
                                    </span>
                                </td>
                                <td className="td-sponsor">{p.project_sponsor || '—'}</td>
                                <td className="td-region">{getRegion(p.project_sponsor)}</td>
                                <td className="td-date">{p.project_start_date || '—'}</td>
                                <td className="td-date">{p.project_end_date || '—'}</td>
                                <td>
                                    <span className={`badge ${isVerified ? 'badge-verified' : 'badge-unverified'}`}>
                                        {isVerified ? '✓' : '✗'}
                                    </span>
                                </td>
                                <td className="td-keywords">
                                    {p.matched_keywords
                                        ? p.matched_keywords.split(',').map((k) => k.trim()).filter(Boolean).slice(0, 3).map((kw) => (
                                            <span key={kw} className="keyword-tag">{kw}</span>
                                        ))
                                        : '—'}
                                </td>
                                <td>
                                    <div className="table-decisions">
                                        <button
                                            className={`decision-btn-sm go ${p.decision === 'Go' ? 'active' : ''}`}
                                            onClick={() => onDecisionChange(realIndex, p.decision === 'Go' ? '' : 'Go')}
                                            title="Go"
                                        >✓</button>
                                        <button
                                            className={`decision-btn-sm nogo ${p.decision === 'No Go' ? 'active' : ''}`}
                                            onClick={() => onDecisionChange(realIndex, p.decision === 'No Go' ? '' : 'No Go')}
                                            title="No Go"
                                        >✗</button>
                                    </div>
                                </td>
                                <td>
                                    <div className="table-links">
                                        {p.project_url && (
                                            <a href={p.project_url} target="_blank" rel="noopener noreferrer" title="Project">🔗</a>
                                        )}
                                        {p.document_url && (
                                            <a href={p.document_url} target="_blank" rel="noopener noreferrer" title="Document">📄</a>
                                        )}
                                    </div>
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

function sourceClass(source) {
    const s = (source || '').toLowerCase();
    if (s.includes('iadb')) return 'iadb';
    if (s.includes('world bank')) return 'wb';
    if (s.includes('global')) return 'gt';
    if (s.includes('giz')) return 'giz';
    return '';
}
