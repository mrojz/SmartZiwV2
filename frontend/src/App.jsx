import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import FilterBar from './components/FilterBar';
import ProjectCard from './components/ProjectCard';
import ProjectTable from './components/ProjectTable';
import SyncPanel from './components/SyncPanel';
import ConfigPanel from './components/ConfigPanel';

const API = '/api';

export default function App() {
    const [projects, setProjects] = useState([]);
    const [loading, setLoading] = useState(true);
    const [syncOpen, setSyncOpen] = useState(false);
    const [configOpen, setConfigOpen] = useState(false);
    const [viewMode, setViewMode] = useState('grid');
    const [regions, setRegions] = useState({});
    const [newProjectIds, setNewProjectIds] = useState(new Set());
    const [showNewOnly, setShowNewOnly] = useState(false);
    const [toast, setToast] = useState(null);
    const preSyncIdsRef = useRef(new Set());

    // filter state
    const [chips, setChips] = useState([]);       // [{field, value}, ...]
    const [freeText, setFreeText] = useState(''); // plain text search
    const [source, setSource] = useState('');
    const [verified, setVerified] = useState('');
    const [keyword, setKeyword] = useState('');
    const [region, setRegion] = useState('');

    const loadProjects = useCallback(async () => {
        try {
            const res = await fetch(`${API}/projects`);
            const data = await res.json();
            setProjects(data);
        } catch (err) {
            console.error('Failed to load projects:', err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadProjects();
        // Load config for regions
        fetch('/api/config')
            .then((r) => r.json())
            .then((cfg) => setRegions(cfg.regions || {}))
            .catch(() => { });

        // Listen for real-time notifications (new projects from any user's sync)
        let eventSource;
        const connectNotifications = () => {
            eventSource = new EventSource('/api/notifications/stream');
            eventSource.onmessage = (e) => {
                try {
                    const event = JSON.parse(e.data);
                    if (event.type === 'new_projects') {
                        // Play notification sound
                        const audio = new Audio('/faceit_accept_sound_epic_-8962405019821701368.mp3');
                        audio.volume = 0.7;
                        audio.play().catch(() => { });
                        // Show toast and reload
                        setToast({ type: 'success', message: `🔔 ${event.count} new project${event.count === 1 ? '' : 's'} just scraped!` });
                        loadProjects();
                    }
                } catch { }
            };
            eventSource.onerror = () => {
                eventSource.close();
                // Reconnect after 5s
                setTimeout(connectNotifications, 5000);
            };
        };
        connectNotifications();

        return () => eventSource?.close();
    }, [loadProjects]);

    // Auto-dismiss toast
    useEffect(() => {
        if (toast) {
            const timer = setTimeout(() => setToast(null), 8000);
            return () => clearTimeout(timer);
        }
    }, [toast]);

    // Snapshot IDs before sync starts
    const snapshotBeforeSync = useCallback(() => {
        const ids = new Set(projects.map((p) => `${p.project_id}__${p.project_name}`));
        preSyncIdsRef.current = ids;
    }, [projects]);

    // After sync finishes: reload, find new, show toast
    const handleSyncDone = useCallback(async () => {
        const prevIds = preSyncIdsRef.current;
        const res = await fetch(`${API}/projects`);
        const data = await res.json();
        setProjects(data);

        const newIds = new Set();
        data.forEach((p) => {
            const key = `${p.project_id}__${p.project_name}`;
            if (!prevIds.has(key)) newIds.add(key);
        });

        setNewProjectIds(newIds);
        if (newIds.size > 0) {
            setShowNewOnly(true);
            setToast({ type: 'success', message: `✅ Sync complete — ${newIds.size} new project${newIds.size === 1 ? '' : 's'} found` });
        } else {
            setToast({ type: 'info', message: '✅ Sync complete — no new projects found' });
        }
    }, []);

    // Decision update
    const handleDecisionChange = async (index, decision) => {
        // Optimistic update
        setProjects((prev) => {
            const next = [...prev];
            next[index] = { ...next[index], decision };
            return next;
        });

        try {
            await fetch(`${API}/projects/${index}/decision`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ decision }),
            });
        } catch (err) {
            console.error('Failed to update decision:', err);
            // Revert on error
            loadProjects();
        }
    };

    // derived data
    const sources = useMemo(
        () => [...new Set(projects.map((p) => p.source).filter(Boolean))].sort(),
        [projects],
    );

    const keywords = useMemo(() => {
        const all = new Set();
        projects.forEach((p) => {
            if (p.matched_keywords) {
                p.matched_keywords.split(',').forEach((k) => {
                    const trimmed = k.trim();
                    if (trimmed) all.add(trimmed);
                });
            }
        });
        return [...all].sort();
    }, [projects]);

    // Helper: get region name for a sponsor string
    const getRegion = useCallback(
        (sponsor) => {
            if (!sponsor) return '';
            const lower = sponsor.toLowerCase();
            for (const [regionName, countries] of Object.entries(regions || {})) {
                if (countries.some((c) => lower.includes(c.toLowerCase()))) return regionName;
            }
            return '';
        },
        [regions],
    );

    const filtered = useMemo(() => {
        // Group chips by field: same field = OR, different fields = AND
        const filterMap = {};
        chips.forEach(({ field, value }) => {
            const f = field.toLowerCase();
            if (!filterMap[f]) filterMap[f] = [];
            filterMap[f].push(value.toLowerCase());
        });

        const ft = freeText.toLowerCase();

        return projects.filter((p) => {
            // Free-text search
            if (ft) {
                const haystack = [
                    p.project_id, p.project_name,
                    p.project_description, p.project_sponsor,
                ].join(' ').toLowerCase();
                if (!haystack.includes(ft)) return false;
            }

            // Chip filters (AND across fields, OR within same field)
            for (const [field, values] of Object.entries(filterMap)) {
                let fieldMatch = false;
                for (const val of values) {
                    switch (field) {
                        case 'source':
                            if ((p.source || '').toLowerCase().includes(val)) fieldMatch = true;
                            break;
                        case 'region': {
                            const projRegion = getRegion(p.project_sponsor).toLowerCase();
                            if (projRegion.includes(val)) fieldMatch = true;
                            break;
                        }
                        case 'sponsor':
                        case 'country':
                            if ((p.project_sponsor || '').toLowerCase().includes(val)) fieldMatch = true;
                            break;
                        case 'keyword':
                        case 'kw': {
                            const kws = (p.matched_keywords || '').toLowerCase();
                            if (kws.includes(val)) fieldMatch = true;
                            break;
                        }
                        case 'ai':
                        case 'verified':
                            if ((p.ai_verified || '').toLowerCase().includes(val)) fieldMatch = true;
                            break;
                        case 'decision':
                            if ((p.decision || '').toLowerCase().includes(val)) fieldMatch = true;
                            break;
                        case 'id':
                            if ((p.project_id || '').toLowerCase().includes(val)) fieldMatch = true;
                            break;
                        default:
                            if ([p.project_id, p.project_name, p.project_description, p.project_sponsor]
                                .join(' ').toLowerCase().includes(val)) fieldMatch = true;
                    }
                    if (fieldMatch) break;
                }
                if (!fieldMatch) return false;
            }

            // Dropdown filters
            if (source && p.source !== source) return false;
            if (verified && p.ai_verified !== verified) return false;
            if (keyword) {
                const kws = (p.matched_keywords || '').split(',').map((k) => k.trim());
                if (!kws.includes(keyword)) return false;
            }
            if (region && regions[region]) {
                const countries = regions[region].map((c) => c.toLowerCase());
                const sponsor = (p.project_sponsor || '').toLowerCase();
                if (!countries.some((c) => sponsor.includes(c))) return false;
            }
            return true;
        });

        // Apply "Show New Only" filter
        if (showNewOnly && newProjectIds.size > 0) {
            return result.filter((p) => newProjectIds.has(`${p.project_id}__${p.project_name}`));
        }
        return result;
    }, [projects, chips, freeText, source, verified, keyword, region, regions, getRegion, showNewOnly, newProjectIds]);

    const verifiedCount = useMemo(
        () => projects.filter((p) => p.ai_verified === 'Yes').length,
        [projects],
    );

    const clearFilters = () => {
        setChips([]);
        setFreeText('');
        setSource('');
        setVerified('');
        setKeyword('');
        setRegion('');
        setShowNewOnly(false);
    };

    if (loading) {
        return (
            <div className="app">
                <div className="loading">
                    <div className="spinner" />
                    <p>Loading projects…</p>
                </div>
            </div>
        );
    }

    return (
        <div className="app">
            {/* Header */}
            <header className="header">
                <div className="header-inner">
                    <div className="header-title">
                        <img className="logo-img" src="/forvis-mazars-logo.svg" alt="Forvis Mazars" />
                        <h1>Procurement Watch</h1>
                    </div>
                    <div className="header-actions">
                        <div className="header-stats">
                            <div className="stat-item">
                                <div className="stat-value">{projects.length}</div>
                                <div className="stat-label">Total</div>
                            </div>
                            <div className="stat-item">
                                <div className="stat-value">{verifiedCount}</div>
                                <div className="stat-label">AI Verified</div>
                            </div>
                            <div className="stat-item">
                                <div className="stat-value">{sources.length}</div>
                                <div className="stat-label">Sources</div>
                            </div>
                        </div>
                        <div className="header-buttons">
                            <a className="download-btn" href="/api/download" download>
                                📥 Excel
                            </a>
                            <button className="sync-btn" onClick={() => setConfigOpen(true)}>
                                ⚙️ Settings
                            </button>
                            <button className="sync-btn" onClick={() => setSyncOpen(true)}>
                                🔄 Sync
                            </button>
                        </div>
                    </div>
                </div>
            </header>

            {/* Filters */}
            <FilterBar
                chips={chips}
                onChipsChange={setChips}
                freeText={freeText}
                onFreeTextChange={setFreeText}
                source={source}
                onSourceChange={setSource}
                verified={verified}
                onVerifiedChange={setVerified}
                keyword={keyword}
                onKeywordChange={setKeyword}
                keywords={keywords}
                sources={sources}
                region={region}
                onRegionChange={setRegion}
                regions={regions}
                onClear={clearFilters}
                projects={projects}
            />

            {/* Content */}
            <main className="main-content">
                <div className="results-info">
                    <span className="results-count">
                        Showing <strong>{filtered.length}</strong> of{' '}
                        <strong>{projects.length}</strong> projects
                        {newProjectIds.size > 0 && (
                            <button
                                className={`new-only-btn ${showNewOnly ? 'active' : ''}`}
                                onClick={() => setShowNewOnly(!showNewOnly)}
                            >
                                🆕 {newProjectIds.size} new
                            </button>
                        )}
                    </span>
                    <div className="view-toggle">
                        <button
                            className={`toggle-btn ${viewMode === 'grid' ? 'active' : ''}`}
                            onClick={() => setViewMode('grid')}
                            title="Grid view"
                        >
                            ▦
                        </button>
                        <button
                            className={`toggle-btn ${viewMode === 'table' ? 'active' : ''}`}
                            onClick={() => setViewMode('table')}
                            title="Table view"
                        >
                            ☰
                        </button>
                    </div>
                </div>

                {filtered.length === 0 ? (
                    <div className="empty-state">
                        <div className="empty-icon">📭</div>
                        <h3>No projects found</h3>
                        <p>Try adjusting your search or filters to find what you're looking for.</p>
                    </div>
                ) : viewMode === 'grid' ? (
                    <div className="projects-grid">
                        {filtered.map((p, i) => (
                            <ProjectCard
                                key={`${p.project_id}-${i}`}
                                project={p}
                                index={projects.indexOf(p)}
                                onDecisionChange={handleDecisionChange}
                            />
                        ))}
                    </div>
                ) : (
                    <ProjectTable
                        projects={filtered}
                        allProjects={projects}
                        onDecisionChange={handleDecisionChange}
                        regions={regions}
                    />
                )}
            </main>

            {/* Sync Panel */}
            <SyncPanel
                open={syncOpen}
                onClose={() => setSyncOpen(false)}
                onSyncDone={handleSyncDone}
                onSyncStart={snapshotBeforeSync}
            />

            {/* Config Panel */}
            <ConfigPanel
                open={configOpen}
                onClose={() => {
                    setConfigOpen(false);
                    // Reload config to update regions
                    fetch('/api/config')
                        .then((r) => r.json())
                        .then((cfg) => setRegions(cfg.regions || {}))
                        .catch(() => { });
                }}
            />

            {/* Toast notification */}
            {toast && (
                <div className={`toast toast-${toast.type}`}>
                    <span>{toast.message}</span>
                    <button className="toast-close" onClick={() => setToast(null)}>×</button>
                </div>
            )}
        </div>
    );
}
