import { useState, useEffect, useCallback } from 'react';
import { Plus, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';

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

function slugifyForId(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'item';
}

export default function SettingsForm({ apiFetch }) {
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

  const keywordCount = keywords.length;
  const regionCount = Object.keys(regions).length;
  const keywordInputId = 'config-keyword-input';
  const regionInputId = 'config-region-input';

  const loadConfig = useCallback(async () => {
    if (!apiFetch) return;
    setLoading(true);
    setLoadError('');
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
    loadConfig();
  }, [loadConfig]);

  const handleSave = async () => {
    if (!apiFetch) return;
    setSaving(true);
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
      toast.success('Settings saved successfully');
    } catch (error) {
      toast.error(error?.message || 'Network error');
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
    <div className="flex min-h-0 flex-1 flex-col">
      <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
        <div className="border-b px-6 pt-4">
          <TabsList>
            <TabsTrigger value="keywords">
              Keywords
              <span className="ml-1.5 rounded-full bg-muted px-1.5 text-xs text-muted-foreground">{keywordCount}</span>
            </TabsTrigger>
            <TabsTrigger value="regions">
              Regions
              <span className="ml-1.5 rounded-full bg-muted px-1.5 text-xs text-muted-foreground">{regionCount}</span>
            </TabsTrigger>
          </TabsList>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <div className="p-6">
            {loading ? (
              <div className="flex flex-col items-center justify-center gap-3 py-16">
                <span className="size-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-primary" aria-hidden="true" />
                <p className="text-sm text-muted-foreground">Loading settings...</p>
              </div>
            ) : loadError ? (
              <div className="flex flex-col items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-center">
                <p className="text-sm text-destructive">{loadError}</p>
                <Button type="button" variant="outline" size="sm" onClick={loadConfig}>
                  <RefreshCw />
                  Retry
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-5">
                {tab === 'keywords' ? (
                  <>
                    <div className="flex flex-col gap-1">
                      <h3 className="text-base font-semibold text-foreground">Keywords</h3>
                      <p className="text-sm text-muted-foreground">Add and curate search terms used to match procurement opportunities.</p>
                    </div>

                    <div className="flex flex-col gap-3 rounded-lg border bg-card p-6">
                      <div className="flex flex-col gap-1">
                        <Label htmlFor={keywordInputId} className="text-sm font-medium">New keyword</Label>
                        <span className="text-xs text-muted-foreground">Use concise terms analysts will search and maintain.</span>
                      </div>
                      <div className="flex gap-2">
                        <Input
                          id={keywordInputId}
                          name="keyword"
                          placeholder="Type a keyword"
                          value={newKeyword}
                          onChange={(e) => setNewKeyword(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && addKeyword()}
                        />
                        <Button type="button" variant="outline" onClick={addKeyword}>
                          <Plus />
                          Add
                        </Button>
                      </div>
                    </div>

                    {keywords.length > 0 ? (
                      <div className="flex flex-col gap-2">
                        {keywords.map((kw) => (
                          <div key={kw} className="flex items-center justify-between gap-3 rounded-lg border bg-card px-4 py-2.5">
                            <span className="text-sm font-medium text-foreground">{kw}</span>
                            <Button type="button" variant="ghost" size="sm" onClick={() => removeKeyword(kw)}>
                              Remove
                            </Button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-lg border border-dashed py-8 text-center">
                        <p className="text-sm text-muted-foreground">No keywords saved yet.</p>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div className="flex flex-col gap-1">
                      <h3 className="text-base font-semibold text-foreground">Regions</h3>
                      <p className="text-sm text-muted-foreground">Group countries into reusable region filters for faster analysis.</p>
                    </div>

                    <div className="flex flex-col gap-3 rounded-lg border bg-card p-6">
                      <div className="flex flex-col gap-1">
                        <Label htmlFor={regionInputId} className="text-sm font-medium">New region</Label>
                        <span className="text-xs text-muted-foreground">Create a region first, then add the countries that belong to it.</span>
                      </div>
                      <div className="flex gap-2">
                        <Input
                          id={regionInputId}
                          name="regionName"
                          placeholder="Region name"
                          value={newRegionName}
                          onChange={(e) => setNewRegionName(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && addRegion()}
                        />
                        <Button type="button" variant="outline" onClick={addRegion}>
                          <Plus />
                          Add
                        </Button>
                      </div>
                    </div>

                    {regionCount > 0 ? (
                      <div className="flex flex-col gap-3">
                        {Object.entries(regions).map(([name, countries]) => {
                          const isOpen = editingRegion === name;
                          const countryInputId = `config-country-input-${slugifyForId(name)}`;
                          return (
                            <div key={name} className="flex flex-col overflow-hidden rounded-lg border bg-card">
                              <div className="flex items-center justify-between gap-3 px-4 py-3">
                                <button
                                  type="button"
                                  className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                                  onClick={() => setEditingRegion(isOpen ? null : name)}
                                >
                                  <span className={`flex size-5 shrink-0 items-center justify-center rounded-full text-sm font-medium ${isOpen ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                                    {isOpen ? '-' : '+'}
                                  </span>
                                  <span className="flex min-w-0 flex-col">
                                    <span className="truncate text-sm font-semibold text-foreground">{name}</span>
                                    <span className="text-xs text-muted-foreground">{countries.length} countries</span>
                                  </span>
                                </button>
                                <Button type="button" variant="ghost" size="sm" onClick={() => deleteRegion(name)}>
                                  Delete
                                </Button>
                              </div>

                              {isOpen ? (
                                <div className="flex flex-col gap-3 border-t bg-muted/30 px-4 py-4">
                                  <div className="flex gap-2">
                                    <Input
                                      id={countryInputId}
                                      name={`country-${name}`}
                                      placeholder={`Add country to ${name}`}
                                      value={newCountry}
                                      onChange={(e) => setNewCountry(e.target.value)}
                                      onKeyDown={(e) => e.key === 'Enter' && addCountryToRegion(name)}
                                    />
                                    <Button type="button" variant="outline" onClick={() => addCountryToRegion(name)}>
                                      <Plus />
                                      Add
                                    </Button>
                                  </div>

                                  {countries.length > 0 ? (
                                    <div className="flex flex-col gap-2">
                                      {countries.map((country) => (
                                        <div key={country} className="flex items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2">
                                          <span className="text-sm font-medium text-foreground">{country}</span>
                                          <Button type="button" variant="ghost" size="sm" onClick={() => removeCountryFromRegion(name, country)}>
                                            Remove
                                          </Button>
                                        </div>
                                      ))}
                                    </div>
                                  ) : (
                                    <div className="rounded-lg border border-dashed py-6 text-center">
                                      <p className="text-sm text-muted-foreground">No countries added yet.</p>
                                    </div>
                                  )}
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="rounded-lg border border-dashed py-8 text-center">
                        <p className="text-sm text-muted-foreground">No regions saved yet.</p>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </ScrollArea>
      </Tabs>

      <div className="flex items-center justify-end gap-3 border-t p-4">
        <Button type="button" onClick={handleSave} disabled={saving || loading || !!loadError}>
          {saving ? 'Saving...' : 'Save Settings'}
        </Button>
      </div>
    </div>
  );
}
