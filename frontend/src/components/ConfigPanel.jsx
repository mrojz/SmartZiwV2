import { useState, useEffect } from 'react';

export default function ConfigPanel({ open, onClose }) {
  const [tab, setTab] = useState('keywords');
  const [keywords, setKeywords] = useState([]);
  const [regions, setRegions] = useState({});
  const [newKeyword, setNewKeyword] = useState('');
  const [newRegionName, setNewRegionName] = useState('');
  const [newCountry, setNewCountry] = useState('');
  const [editingRegion, setEditingRegion] = useState(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null);

  useEffect(() => {
    if (open) {
      fetch('/api/config')
        .then((r) => r.json())
        .then((cfg) => {
          setKeywords(cfg.keywords || []);
          setRegions(cfg.regions || {});
          setStatus(null);
        })
        .catch(() => setStatus({ error: true, msg: 'Failed to load config' }));
    }
  }, [open]);

  if (!open) return null;

  const handleSave = async () => {
    setSaving(true);
    setStatus(null);
    try {
      const res = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keywords, regions }),
      });
      if (res.ok) {
        setStatus({ error: false, msg: 'Saved successfully' });
      } else {
        setStatus({ error: true, msg: 'Save failed' });
      }
    } catch {
      setStatus({ error: true, msg: 'Network error' });
    }
    setSaving(false);
  };

  const addKeyword = () => {
    const kw = newKeyword.trim();
    if (kw && !keywords.includes(kw)) {
      setKeywords([...keywords, kw]);
      setNewKeyword('');
    }
  };

  const removeKeyword = (kw) => {
    setKeywords(keywords.filter((k) => k !== kw));
  };

  const addRegion = () => {
    const name = newRegionName.trim();
    if (name && !regions[name]) {
      setRegions({ ...regions, [name]: [] });
      setNewRegionName('');
      setEditingRegion(name);
    }
  };

  const deleteRegion = (name) => {
    const next = { ...regions };
    delete next[name];
    setRegions(next);
    if (editingRegion === name) setEditingRegion(null);
  };

  const addCountryToRegion = (regionName) => {
    const c = newCountry.trim();
    if (c && !regions[regionName].includes(c)) {
      setRegions({
        ...regions,
        [regionName]: [...regions[regionName], c],
      });
      setNewCountry('');
    }
  };

  const removeCountryFromRegion = (regionName, country) => {
    setRegions({
      ...regions,
      [regionName]: regions[regionName].filter((c) => c !== country),
    });
  };

  return (
    <div className="sync-overlay" onClick={onClose}>
      <div className="config-panel" onClick={(e) => e.stopPropagation()}>
        <div className="sync-header">
          <h2>Settings</h2>
          <button className="sync-close" onClick={onClose}>x</button>
        </div>

        <div className="config-tabs">
          <button
            className={`config-tab ${tab === 'keywords' ? 'active' : ''}`}
            onClick={() => setTab('keywords')}
          >
            Keywords ({keywords.length})
          </button>
          <button
            className={`config-tab ${tab === 'regions' ? 'active' : ''}`}
            onClick={() => setTab('regions')}
          >
            Regions ({Object.keys(regions).length})
          </button>
        </div>

        <div className="config-body">
          {tab === 'keywords' && (
            <div className="config-section">
              <div className="config-add-row">
                <input
                  type="text"
                  placeholder="Add keyword..."
                  value={newKeyword}
                  onChange={(e) => setNewKeyword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addKeyword()}
                  className="config-input"
                />
                <button className="config-add-btn" onClick={addKeyword}>+</button>
              </div>
              <div className="config-tags">
                {keywords.map((kw) => (
                  <span key={kw} className="config-tag">
                    {kw}
                    <button onClick={() => removeKeyword(kw)}>x</button>
                  </span>
                ))}
              </div>
            </div>
          )}

          {tab === 'regions' && (
            <div className="config-section">
              <div className="config-add-row">
                <input
                  type="text"
                  placeholder="New region name..."
                  value={newRegionName}
                  onChange={(e) => setNewRegionName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addRegion()}
                  className="config-input"
                />
                <button className="config-add-btn" onClick={addRegion}>+</button>
              </div>
              <div className="config-regions">
                {Object.entries(regions).map(([name, countries]) => (
                  <div key={name} className={`region-card ${editingRegion === name ? 'expanded' : ''}`}>
                    <div
                      className="region-header"
                      onClick={() => setEditingRegion(editingRegion === name ? null : name)}
                    >
                      <span className="region-name">
                        {editingRegion === name ? 'v' : '>'} {name}
                      </span>
                      <span className="region-count">{countries.length} countries</span>
                      <button
                        className="region-delete"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteRegion(name);
                        }}
                      >
                        Delete
                      </button>
                    </div>
                    {editingRegion === name && (
                      <div className="region-body">
                        <div className="config-add-row">
                          <input
                            type="text"
                            placeholder="Add country..."
                            value={newCountry}
                            onChange={(e) => setNewCountry(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && addCountryToRegion(name)}
                            className="config-input"
                          />
                          <button className="config-add-btn" onClick={() => addCountryToRegion(name)}>
                            +
                          </button>
                        </div>
                        <div className="config-tags">
                          {countries.map((c) => (
                            <span key={c} className="config-tag country-tag">
                              {c}
                              <button onClick={() => removeCountryFromRegion(name, c)}>x</button>
                            </span>
                          ))}
                          {countries.length === 0 && <span className="config-empty">No countries added yet</span>}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="config-footer">
          {status && (
            <span className={`config-status ${status.error ? 'error' : 'success'}`}>
              {status.error ? 'Error:' : 'Saved:'} {status.msg}
            </span>
          )}
          <button className="sync-run-btn" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save Config'}
          </button>
        </div>
      </div>
    </div>
  );
}
