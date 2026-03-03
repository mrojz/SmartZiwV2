import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import ProjectTable from './components/ProjectTable';
import SyncPanel from './components/SyncPanel';
import ConfigPanel from './components/ConfigPanel';
import SchedulePanel from './components/SchedulePanel';

const API = '/api';

export default function App() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncOpen, setSyncOpen] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [regions, setRegions] = useState({});
  const [newProjectIds, setNewProjectIds] = useState(new Set());
  const [showNewOnly, setShowNewOnly] = useState(false);
  const [toast, setToast] = useState(null);
  const preSyncIdsRef = useRef(new Set());
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'light');

  const [chips, setChips] = useState([]);
  const [freeText, setFreeText] = useState('');
  const [source, setSource] = useState('');
  const [verified, setVerified] = useState('Yes');
  const [region, setRegion] = useState('');
  const [decision, setDecision] = useState('');
  const [startDateFrom, setStartDateFrom] = useState('');
  const [startDateTo, setStartDateTo] = useState('');
  const [endDateFrom, setEndDateFrom] = useState('');
  const [endDateTo, setEndDateTo] = useState('');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

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
    fetch('/api/config')
      .then((r) => r.json())
      .then((cfg) => setRegions(cfg.regions || {}))
      .catch(() => {});

    let eventSource;
    const connectNotifications = () => {
      eventSource = new EventSource('/api/notifications/stream');
      eventSource.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data);
          if (event.type === 'new_projects') {
            const audio = new Audio('/faceit_accept_sound_epic_-8962405019821701368.mp3');
            audio.volume = 0.7;
            audio.play().catch(() => {});
            setToast({
              type: 'success',
              message: `${event.count} new project${event.count === 1 ? '' : 's'} just scraped.`,
            });
            loadProjects();
          }
        } catch {}
      };
      eventSource.onerror = () => {
        eventSource.close();
        setTimeout(connectNotifications, 5000);
      };
    };
    connectNotifications();

    return () => eventSource?.close();
  }, [loadProjects]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(timer);
  }, [toast]);

  const snapshotBeforeSync = useCallback(() => {
    const ids = new Set(projects.map((p) => `${p.project_id}__${p.project_name}`));
    preSyncIdsRef.current = ids;
  }, [projects]);

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
      setToast({
        type: 'success',
        message: `Sync complete: ${newIds.size} new project${newIds.size === 1 ? '' : 's'} found.`,
      });
    } else {
      setToast({ type: 'info', message: 'Sync complete: no new projects found.' });
    }
  }, []);

  const handleDecisionChange = async (index, nextDecision) => {
    setProjects((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], decision: nextDecision };
      return next;
    });

    try {
      await fetch(`${API}/projects/${index}/decision`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: nextDecision }),
      });
    } catch (err) {
      console.error('Failed to update decision:', err);
      loadProjects();
    }
  };

  const handleDelete = async (index) => {
    try {
      const res = await fetch(`${API}/projects/${index}`, { method: 'DELETE' });
      if (res.ok) {
        setProjects((prev) => prev.filter((_, i) => i !== index));
        setToast({ type: 'success', message: 'Project deleted.' });
      } else {
        const err = await res.json();
        setToast({ type: 'error', message: err.detail || 'Failed to delete.' });
      }
    } catch (err) {
      console.error('Failed to delete project:', err);
      setToast({ type: 'error', message: `Network error: ${err.message}` });
    }
  };

  const sources = useMemo(
    () => [...new Set(projects.map((p) => p.source).filter(Boolean))].sort(),
    [projects],
  );

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
    const filterMap = {};
    chips.forEach(({ field, value }) => {
      const f = field.toLowerCase();
      if (!filterMap[f]) filterMap[f] = [];
      filterMap[f].push(value.toLowerCase());
    });

    const ft = freeText.toLowerCase();
    const result = projects.filter((p) => {
      if (ft) {
        const haystack = [p.project_id, p.project_name, p.project_description, p.project_sponsor]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(ft)) return false;
      }

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
            case 'kw':
              if ((p.matched_keywords || '').toLowerCase().includes(val)) fieldMatch = true;
              break;
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
                .join(' ')
                .toLowerCase()
                .includes(val)) {
                fieldMatch = true;
              }
          }
          if (fieldMatch) break;
        }
        if (!fieldMatch) return false;
      }

      if (source && p.source !== source) return false;
      if (verified && p.ai_verified !== verified) return false;
      if (region && regions[region]) {
        const countries = regions[region].map((c) => c.toLowerCase());
        const sponsor = (p.project_sponsor || '').toLowerCase();
        if (!countries.some((c) => sponsor.includes(c))) return false;
      }
      if (decision) {
        if (decision === 'Undecided') {
          if (p.decision) return false;
        } else if (p.decision !== decision) {
          return false;
        }
      }
      if (startDateFrom || startDateTo) {
        const raw = p.project_start_date;
        if (!raw) return false;
        let d;
        const parts = raw.split('/');
        if (parts.length === 3) d = new Date(parts[2], parts[0] - 1, parts[1]);
        else d = new Date(raw);
        if (Number.isNaN(d.getTime())) return false;
        if (startDateFrom && d < new Date(startDateFrom)) return false;
        if (startDateTo && d > new Date(`${startDateTo}T23:59:59`)) return false;
      }
      if (endDateFrom || endDateTo) {
        const raw = p.project_end_date;
        if (!raw) return false;
        let d;
        const parts = raw.split('/');
        if (parts.length === 3) d = new Date(parts[2], parts[0] - 1, parts[1]);
        else d = new Date(raw);
        if (Number.isNaN(d.getTime())) return false;
        if (endDateFrom && d < new Date(endDateFrom)) return false;
        if (endDateTo && d > new Date(`${endDateTo}T23:59:59`)) return false;
      }
      return true;
    });

    if (showNewOnly && newProjectIds.size > 0) {
      return result.filter((p) => newProjectIds.has(`${p.project_id}__${p.project_name}`));
    }
    return result;
  }, [
    projects,
    chips,
    freeText,
    source,
    verified,
    region,
    regions,
    getRegion,
    decision,
    startDateFrom,
    startDateTo,
    endDateFrom,
    endDateTo,
    showNewOnly,
    newProjectIds,
  ]);

  const verifiedCount = useMemo(
    () => projects.filter((p) => p.ai_verified === 'Yes').length,
    [projects],
  );

  const clearFilters = () => {
    setChips([]);
    setFreeText('');
    setSource('');
    setVerified('Yes');
    setRegion('');
    setDecision('');
    setStartDateFrom('');
    setStartDateTo('');
    setEndDateFrom('');
    setEndDateTo('');
    setShowNewOnly(false);
  };

  if (loading) {
    return (
      <div className="app">
        <div className="loading">
          <div className="spinner" />
          <p>Loading projects...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="header">
        <div className="header-inner">
          <div className="header-title">
            <img className="logo-img" src="/forvis-mazars-logo.svg" alt="Forvis Mazars" />
            <div className="header-copy">
              <p className="header-kicker">Intelligence Dashboard</p>
              <h1>Procurement Watch</h1>
              <div className="header-counters">
                <span className="counter-item"><strong>{projects.length}</strong> total</span>
                <span className="counter-sep">|</span>
                <span className="counter-item"><strong>{verifiedCount}</strong> verified</span>
                <span className="counter-sep">|</span>
                <span className="counter-item"><strong>{sources.length}</strong> sources</span>
              </div>
            </div>
          </div>
          <div className="header-actions">
            <div className="header-buttons">
              <button
                className="download-btn"
                onClick={async () => {
                  const indices = filtered.map((p) => projects.indexOf(p)).filter((i) => i >= 0);
                  try {
                    const res = await fetch('/api/download', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ indices }),
                    });
                    if (!res.ok) throw new Error('Download failed');
                    const blob = await res.blob();
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'projects.xlsx';
                    a.click();
                    URL.revokeObjectURL(url);
                  } catch {
                    setToast({ type: 'error', message: 'Export failed.' });
                  }
                }}
              >
                Export Excel ({filtered.length})
              </button>
              <button className="header-secondary-btn" onClick={() => setScheduleOpen(true)}>
                Schedule
              </button>
              <button className="sync-btn primary" onClick={() => setSyncOpen(true)}>
                Sync
              </button>
            </div>
            <div className="header-icon-buttons">
              <button
                className="header-icon-btn"
                onClick={() => setConfigOpen(true)}
                title="Settings"
              >
                Settings
              </button>
              <label
                className="theme-switch"
                title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              >
                <input
                  type="checkbox"
                  checked={theme === 'dark'}
                  onChange={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
                />
                <span className="theme-switch-track">
                  <span className="theme-switch-sun" />
                  <span className="theme-switch-moon" />
                  <span className="theme-switch-thumb" />
                </span>
                <span className="theme-switch-label">{theme === 'dark' ? 'Dark' : 'Light'}</span>
              </label>
            </div>
          </div>
        </div>
      </header>

      <main className="main-content">
        <div className="results-info">
          <span className="results-count">
            Showing <strong>{filtered.length}</strong> of <strong>{projects.length}</strong> projects
            {newProjectIds.size > 0 && (
              <button
                className={`new-only-btn ${showNewOnly ? 'active' : ''}`}
                onClick={() => setShowNewOnly(!showNewOnly)}
              >
                {newProjectIds.size} new
              </button>
            )}
          </span>
        </div>

        <ProjectTable
          projects={filtered}
          allProjects={projects}
          onDecisionChange={handleDecisionChange}
          onDelete={handleDelete}
          regions={regions}
          chips={chips}
          onChipsChange={setChips}
          freeText={freeText}
          onFreeTextChange={setFreeText}
          source={source}
          onSourceChange={setSource}
          verified={verified}
          onVerifiedChange={setVerified}
          sources={sources}
          decision={decision}
          onDecisionChangeFilter={setDecision}
          startDateFrom={startDateFrom}
          onStartDateFromChange={setStartDateFrom}
          startDateTo={startDateTo}
          onStartDateToChange={setStartDateTo}
          endDateFrom={endDateFrom}
          onEndDateFromChange={setEndDateFrom}
          endDateTo={endDateTo}
          onEndDateToChange={setEndDateTo}
          onClearFilters={clearFilters}
        />
      </main>

      <SyncPanel
        open={syncOpen}
        onClose={() => setSyncOpen(false)}
        onSyncDone={handleSyncDone}
        onSyncStart={snapshotBeforeSync}
      />

      <ConfigPanel
        open={configOpen}
        onClose={() => {
          setConfigOpen(false);
          fetch('/api/config')
            .then((r) => r.json())
            .then((cfg) => setRegions(cfg.regions || {}))
            .catch(() => {});
        }}
      />

      <SchedulePanel open={scheduleOpen} onClose={() => setScheduleOpen(false)} />

      {toast && (
        <div className={`toast toast-${toast.type}`}>
          <span>{toast.message}</span>
          <button className="toast-close" onClick={() => setToast(null)}>x</button>
        </div>
      )}
    </div>
  );
}



