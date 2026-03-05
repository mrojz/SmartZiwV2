import { useState, useEffect } from 'react';
import { X, Plus } from '@untitledui/icons';
import { Button } from '@/components/base/buttons/button';
import { Input } from '@/components/base/input/input';
import { BadgeWithButton } from '@/components/base/badges/badges';
import { Tabs } from '@/components/application/tabs/tabs';

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
          <Button color="tertiary" size="sm" iconLeading={X} onPress={onClose} />
        </div>

        <div className="config-tabs">
          <Button
            color={tab === 'keywords' ? 'primary' : 'secondary'}
            size="sm"
            onPress={() => setTab('keywords')}
          >
            Keywords ({keywords.length})
          </Button>
          <Button
            color={tab === 'regions' ? 'primary' : 'secondary'}
            size="sm"
            onPress={() => setTab('regions')}
          >
            Regions ({Object.keys(regions).length})
          </Button>
        </div>

        <div className="config-body">
          {tab === 'keywords' && (
            <div className="config-section">
              <div className="config-add-row">
                <Input
                  placeholder="Add keyword..."
                  value={newKeyword}
                  onChange={(e) => setNewKeyword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addKeyword()}
                />
                <Button color="primary" size="sm" iconLeading={Plus} onPress={addKeyword} />
              </div>
              <div className="config-tags">
                {keywords.map((kw) => (
                  <BadgeWithButton key={kw} color="brand" size="sm" onButtonClick={() => removeKeyword(kw)} buttonLabel="Remove">
                    {kw}
                  </BadgeWithButton>
                ))}
              </div>
            </div>
          )}

          {tab === 'regions' && (
            <div className="config-section">
              <div className="config-add-row">
                <Input
                  placeholder="New region name..."
                  value={newRegionName}
                  onChange={(e) => setNewRegionName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addRegion()}
                />
                <Button color="primary" size="sm" iconLeading={Plus} onPress={addRegion} />
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
                      <Button
                        color="primary-destructive"
                        size="sm"
                        onPress={(e) => {
                          deleteRegion(name);
                        }}
                      >
                        Delete
                      </Button>
                    </div>
                    {editingRegion === name && (
                      <div className="region-body">
                        <div className="config-add-row">
                          <Input
                            placeholder="Add country..."
                            value={newCountry}
                            onChange={(e) => setNewCountry(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && addCountryToRegion(name)}
                          />
                          <Button color="primary" size="sm" iconLeading={Plus} onPress={() => addCountryToRegion(name)} />
                        </div>
                        <div className="config-tags">
                          {countries.map((c) => (
                            <BadgeWithButton key={c} color="blue" size="sm" onButtonClick={() => removeCountryFromRegion(name, c)} buttonLabel="Remove">
                              {c}
                            </BadgeWithButton>
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
          <Button color="primary" onPress={handleSave} isDisabled={saving} isLoading={saving}>
            Save Config
          </Button>
        </div>
      </div>
    </div>
  );
}
