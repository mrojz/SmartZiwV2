import { useState, useEffect, useCallback } from 'react';
import { X, Plus, RefreshCw01 } from '@untitledui/icons';

function normalizeKeywords(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => String(item || '').trim()).filter(Boolean);
}

function normalizeRegions(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw)
      .map(([name, countries]) => [
        String(name || '').trim(),
        Array.isArray(countries)
          ? countries.map((country) => String(country || '').trim()).filter(Boolean)
          : [],
      ])
      .filter(([name]) => Boolean(name))
  );
}

function ModalButton({ className = '', children, ...props }) {
  return (
    <button type="button" className={`config-ui-btn ${className}`.trim()} {...props}>
      {children}
    </button>
  );
}

export default function ConfigPanel({ open, onClose, apiFetch }) {
  const [tab, setTab] = useState('keywords');
  const [keywords, setKeywords] = useState([]);
  const [regions, setRegions] = useState({});
  const [newKeyword, setNewKeyword] = useState('');
  const [newRegionName, setNewRegionName] = useState('');
  const [newCountry, setNewCountry] = useState('');
  const [editingRegion, setEditingRegion] = useState(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [status, setStatus] = useState(null);

  const keywordCount = keywords.length;
  const regionCount = Object.keys(regions).length;

  const loadConfig = useCallback(async () => {
    if (!apiFetch) return;
    setLoading(true);
    setLoadError('');
    setStatus(null);
    try {
      const res = await apiFetch('/api/config');
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.detail || 'Failed to load settings');
      }
      const cfg = await res.json();
      const nextKeywords = normalizeKeywords(cfg?.keywords);
      const nextRegions = normalizeRegions(cfg?.regions);
      setKeywords(nextKeywords);
      setRegions(nextRegions);
      setEditingRegion((current) => (current && nextRegions[current] ? current : Object.keys(nextRegions)[0] || null));
    } catch (error) {
      setKeywords([]);
      setRegions({});
      setEditingRegion(null);
      setLoadError(error?.message || 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    if (open) loadConfig();
  }, [open, loadConfig]);

  if (!open) return null;

  const handleSave = async () => {
    if (!apiFetch) return;
    setSaving(true);
    setStatus(null);
    try {
      const res = await apiFetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keywords, regions }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.detail || 'Save failed');
      }
      const data = await res.json().catch(() => ({}));
      setStatus({ error: false, msg: data?.status === 'saved' ? 'Settings saved successfully' : 'Saved successfully' });
    } catch (error) {
      setStatus({ error: true, msg: error?.message || 'Network error' });
    } finally {
      setSaving(false);
    }
  };

  const addKeyword = () => {
    const kw = newKeyword.trim();
    if (kw && !keywords.includes(kw)) {
      setKeywords((prev) => [...prev, kw]);
      setNewKeyword('');
    }
  };

  const removeKeyword = (kw) => {
    setKeywords((prev) => prev.filter((item) => item !== kw));
  };

  const addRegion = () => {
    const name = newRegionName.trim();
    if (name && !regions[name]) {
      setRegions((prev) => ({ ...prev, [name]: [] }));
      setNewRegionName('');
      setEditingRegion(name);
    }
  };

  const deleteRegion = (name) => {
    const next = { ...regions };
    delete next[name];
    setRegions(next);
    if (editingRegion === name) setEditingRegion(Object.keys(next)[0] || null);
  };

  const addCountryToRegion = (regionName) => {
    const country = newCountry.trim();
    if (country && !regions[regionName].includes(country)) {
      setRegions((prev) => ({
        ...prev,
        [regionName]: [...prev[regionName], country],
      }));
      setNewCountry('');
    }
  };

  const removeCountryFromRegion = (regionName, country) => {
    setRegions((prev) => ({
      ...prev,
      [regionName]: prev[regionName].filter((item) => item !== country),
    }));
  };

  return (
    <div className="sync-overlay" onClick={onClose}>
      <div className="config-panel config-shell" onClick={(e) => e.stopPropagation()}>
        <header className="config-shell-header">
          <div className="config-shell-heading">
            <h2>Settings</h2>
            <p>Manage watch keywords and region groups used across Procurement Watch.</p>
          </div>
          <button type="button" className="config-shell-close" onClick={onClose} aria-label="Close settings">
            <X />
          </button>
        </header>

        <div className="config-shell-tabs" role="tablist" aria-label="Settings sections">
          <button
            type="button"
            className={`config-shell-tab ${tab === 'keywords' ? 'is-active' : ''}`}
            onClick={() => setTab('keywords')}
            role="tab"
            aria-selected={tab === 'keywords'}
          >
            <span>Keywords</span>
            <span className="config-shell-tab-count">{keywordCount}</span>
          </button>
          <button
            type="button"
            className={`config-shell-tab ${tab === 'regions' ? 'is-active' : ''}`}
            onClick={() => setTab('regions')}
            role="tab"
            aria-selected={tab === 'regions'}
          >
            <span>Regions</span>
            <span className="config-shell-tab-count">{regionCount}</span>
          </button>
        </div>

        <div className="config-shell-body">
          {loading ? (
            <div className="config-shell-state">
              <div className="spinner" />
              <p>Loading settings...</p>
            </div>
          ) : loadError ? (
            <div className="config-shell-state is-error">
              <p>{loadError}</p>
              <ModalButton className="config-ui-btn-secondary config-ui-btn-inline" onClick={loadConfig}>
                <RefreshCw01 className="config-ui-icon" />
                Retry
              </ModalButton>
            </div>
          ) : (
            <section className="config-shell-section">
              {tab === 'keywords' ? (
                <>
                  <div className="config-shell-section-header">
                    <div>
                      <h3>Keywords</h3>
                      <p>Add and curate search terms used to match procurement opportunities.</p>
                    </div>
                  </div>

                  <div className="config-shell-input-card">
                    <div className="config-shell-input-copy">
                      <span className="config-shell-label">New keyword</span>
                      <span className="config-shell-hint">Use concise terms analysts will search and maintain.</span>
                    </div>
                    <div className="config-shell-entry-row">
                      <input
                        className="config-shell-input"
                        placeholder="Type a keyword"
                        value={newKeyword}
                        onChange={(e) => setNewKeyword(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && addKeyword()}
                      />
                      <ModalButton className="config-ui-btn-secondary config-ui-btn-add" onClick={addKeyword}>
                        <Plus className="config-ui-icon" />
                        Add
                      </ModalButton>
                    </div>
                  </div>

                  {keywords.length > 0 ? (
                    <div className="config-shell-list">
                      {keywords.map((kw) => (
                        <div key={kw} className="config-shell-list-row">
                          <div className="config-shell-list-copy">
                            <span className="config-shell-list-title">{kw}</span>
                          </div>
                          <button type="button" className="config-shell-row-action" onClick={() => removeKeyword(kw)}>
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="config-shell-empty">
                      <p>No keywords saved yet.</p>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="config-shell-section-header">
                    <div>
                      <h3>Regions</h3>
                      <p>Group countries into reusable region filters for faster analysis.</p>
                    </div>
                  </div>

                  <div className="config-shell-input-card">
                    <div className="config-shell-input-copy">
                      <span className="config-shell-label">New region</span>
                      <span className="config-shell-hint">Create a region first, then add the countries that belong to it.</span>
                    </div>
                    <div className="config-shell-entry-row">
                      <input
                        className="config-shell-input"
                        placeholder="Region name"
                        value={newRegionName}
                        onChange={(e) => setNewRegionName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && addRegion()}
                      />
                      <ModalButton className="config-ui-btn-secondary config-ui-btn-add" onClick={addRegion}>
                        <Plus className="config-ui-icon" />
                        Add
                      </ModalButton>
                    </div>
                  </div>

                  {regionCount > 0 ? (
                    <div className="config-shell-region-stack">
                      {Object.entries(regions).map(([name, countries]) => {
                        const isOpen = editingRegion === name;
                        return (
                          <article key={name} className={`config-shell-region-card ${isOpen ? 'is-open' : ''}`}>
                            <div className="config-shell-region-top">
                              <button type="button" className="config-shell-region-summary" onClick={() => setEditingRegion(isOpen ? null : name)}>
                                <span className="config-shell-region-indicator">{isOpen ? '-' : '+'}</span>
                                <span className="config-shell-region-copy">
                                  <span className="config-shell-region-title">{name}</span>
                                  <span className="config-shell-region-meta">{countries.length} countries</span>
                                </span>
                              </button>
                              <button type="button" className="config-shell-row-action" onClick={() => deleteRegion(name)}>
                                Delete
                              </button>
                            </div>

                            {isOpen ? (
                              <div className="config-shell-region-body">
                                <div className="config-shell-entry-row compact">
                                  <input
                                    className="config-shell-input"
                                    placeholder={`Add country to ${name}`}
                                    value={newCountry}
                                    onChange={(e) => setNewCountry(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && addCountryToRegion(name)}
                                  />
                                  <ModalButton className="config-ui-btn-secondary config-ui-btn-add" onClick={() => addCountryToRegion(name)}>
                                    <Plus className="config-ui-icon" />
                                    Add
                                  </ModalButton>
                                </div>

                                {countries.length > 0 ? (
                                  <div className="config-shell-sublist">
                                    {countries.map((country) => (
                                      <div key={country} className="config-shell-sublist-row">
                                        <span className="config-shell-sublist-title">{country}</span>
                                        <button type="button" className="config-shell-row-action" onClick={() => removeCountryFromRegion(name, country)}>
                                          Remove
                                        </button>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <div className="config-shell-empty compact">
                                    <p>No countries added yet.</p>
                                  </div>
                                )}
                              </div>
                            ) : null}
                          </article>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="config-shell-empty">
                      <p>No regions saved yet.</p>
                    </div>
                  )}
                </>
              )}
            </section>
          )}
        </div>

        <footer className="config-shell-footer">
          <ModalButton className="config-ui-btn-secondary config-ui-btn-close" onClick={onClose}>
            Close
          </ModalButton>
          <div className="config-shell-footer-right">
            {status ? (
              <span className={`config-shell-status ${status.error ? 'is-error' : 'is-success'}`}>
                {status.msg}
              </span>
            ) : null}
            <ModalButton className="config-ui-btn-primary config-ui-btn-save" onClick={handleSave} disabled={saving || loading || !!loadError}>
              {saving ? 'Saving...' : 'Save Settings'}
            </ModalButton>
          </div>
        </footer>
      </div>
    </div>
  );
}
