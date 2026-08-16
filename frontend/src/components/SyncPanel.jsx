import { useState, useRef, useEffect } from 'react';
import { LoaderCircle } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';

function setModalScrollLock(locked) {
  if (typeof document === 'undefined') return;
  const body = document.body;
  const html = document.documentElement;
  const current = Number(body.dataset.modalLockCount || '0');
  const next = locked ? current + 1 : Math.max(0, current - 1);
  body.dataset.modalLockCount = String(next);
  const shouldLock = next > 0;
  body.classList.toggle('modal-scroll-locked', shouldLock);
  html.classList.toggle('modal-scroll-locked', shouldLock);
}

function buildSyncStreamUrl() {
  const token = localStorage.getItem('pw_access_token');
  const params = new URLSearchParams();
  if (token) params.set('access_token', token);
  const query = params.toString();
  return query ? `/api/sync/stream?${query}` : '/api/sync/stream';
}

const SOURCES = [
  { key: 'iadb', label: 'IADB' },
  { key: 'worldbank', label: 'World Bank' },
  { key: 'globaltenders', label: 'Global Tenders' },
  { key: 'giz', label: 'GIZ' },
  { key: 'devaid', label: 'DevelopmentAid' },
  { key: 'dgmarket', label: 'DGMarket' },
  { key: 'africagateway', label: 'Africa Gateway' },
  { key: 'isdb', label: 'IsDB' },
  { key: 'badea', label: 'BADEA' },
  { key: 'bcie', label: 'BCIE' },
  { key: 'eabr', label: 'EABR' },
  { key: 'oas', label: 'OAS' },
  { key: 'africanunion', label: 'African Union' },
];

export default function SyncPanel({ open, onClose, onSyncDone, onSyncStart, apiFetch }) {
  const [iadb, setIadb] = useState(true);
  const [worldbank, setWorldbank] = useState(true);
  const [globaltenders, setGlobaltenders] = useState(true);
  const [giz, setGiz] = useState(true);
  const [devaid, setDevaid] = useState(true);
  const [dgmarket, setDgmarket] = useState(true);
  const [africagateway, setAfricagateway] = useState(true);
  const [isdb, setIsdb] = useState(true);
  const [badea, setBadea] = useState(true);
  const [bcie, setBcie] = useState(true);
  const [eabr, setEabr] = useState(true);
  const [oas, setOas] = useState(true);
  const [africanunion, setAfricanunion] = useState(true);
  const [noAi, setNoAi] = useState(false);
  const [includeExpired, setIncludeExpired] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [logs, setLogs] = useState([]);
  const [result, setResult] = useState(null);
  const logsEndRef = useRef(null);
  const eventSourceRef = useRef(null);
  const pollRef = useRef(null);
  const logIndexRef = useRef(-1);

  const stopSyncTracking = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (pollRef.current) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const hydrateLogs = (lines = []) => {
    const nextLines = Array.isArray(lines) ? lines : [];
    logIndexRef.current = nextLines.length - 1;
    setLogs(nextLines);
  };

  const startSyncTracking = () => {
    if (eventSourceRef.current) return;
    const eventSource = new EventSource(buildSyncStreamUrl());
    eventSourceRef.current = eventSource;
    setSyncing(true);

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.type === 'log') {
        const nextIndex = typeof data.index === 'number' ? data.index : logIndexRef.current + 1;
        if (nextIndex <= logIndexRef.current) return;
        logIndexRef.current = nextIndex;
        setLogs((prev) => [...prev, data.message]);
        setTimeout(scrollToBottom, 50);
      } else if (data.type === 'done') {
        setResult({
          success: data.success,
          message: data.success ? 'Sync completed successfully' : 'Sync finished with errors',
          project_count: data.project_count,
          summary: data.summary || null,
        });
        setSyncing(false);
        stopSyncTracking();
        onSyncDone?.();
      }
    };

    eventSource.onerror = () => {
      if (eventSourceRef.current === eventSource) {
        eventSource.close();
        eventSourceRef.current = null;
      }
    };

    pollRef.current = window.setInterval(async () => {
      try {
        const status = await hydrateFromStatus();
        if (status?.finished && !status?.running) {
          stopSyncTracking();
        }
      } catch {
        // Ignore transient polling issues while sync is active.
      }
    }, 1500);
  };

  useEffect(() => () => stopSyncTracking(), []);

  useEffect(() => {
    if (!open) return undefined;
    setModalScrollLock(true);
    return () => setModalScrollLock(false);
  }, [open]);

  const hydrateFromStatus = async () => {
    if (!apiFetch) return null;
    const res = await apiFetch('/api/sync/status');
    if (!res.ok) return null;
    const data = await res.json();
    const nextLines = Array.isArray(data.lines) ? data.lines : [];
    hydrateLogs(nextLines);
    if (!data.running && data.finished) {
      setSyncing(false);
    }
    return data;
  };

  useEffect(() => {
    if (!open || !apiFetch) return undefined;

    let cancelled = false;

    const attachToRunningSync = async () => {
      try {
        const status = await hydrateFromStatus();
        if (cancelled || !status) return;
        if (status.running) {
          startSyncTracking();
        }
      } catch {
        // Keep modal usable even if status hydration fails.
      }
    };

    attachToRunningSync();

    return () => {
      cancelled = true;
      stopSyncTracking();
    };
  }, [open, apiFetch]);

  if (!open) return null;

  const selectedSources = {
    iadb,
    worldbank,
    globaltenders,
    giz,
    devaid,
    dgmarket,
    africagateway,
    isdb,
    badea,
    bcie,
    eabr,
    oas,
    africanunion,
  };

  const sourceSetters = {
    iadb: setIadb,
    worldbank: setWorldbank,
    globaltenders: setGlobaltenders,
    giz: setGiz,
    devaid: setDevaid,
    dgmarket: setDgmarket,
    africagateway: setAfricagateway,
    isdb: setIsdb,
    badea: setBadea,
    bcie: setBcie,
    eabr: setEabr,
    oas: setOas,
    africanunion: setAfricanunion,
  };

  const selectedSourceCount = Object.values(selectedSources).filter(Boolean).length;

  const scrollToBottom = () => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleSync = async () => {
    setSyncing(true);
    setLogs([]);
    setResult(null);
    onSyncStart?.();
    stopSyncTracking();

    try {
      const startRes = await apiFetch('/api/sync/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          iadb,
          worldbank,
          globaltenders,
          giz,
          devaid,
          dgmarket,
          africagateway,
          isdb,
          badea,
          bcie,
          eabr,
          oas,
          africanunion,
          no_ai: noAi,
          include_expired: includeExpired,
        }),
      });

      if (!startRes.ok) {
        const err = await startRes.json();
        setResult({ success: false, message: err.detail || 'Failed to start sync' });
        setSyncing(false);
        return;
      }

      await hydrateFromStatus();
      startSyncTracking();
    } catch (err) {
      setResult({ success: false, message: `Network error: ${err.message}` });
      setSyncing(false);
      stopSyncTracking();
    }
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <DialogContent className="flex max-h-[90dvh] flex-col gap-0 p-0 sm:max-w-[560px]">
        <DialogHeader className="border-b p-5">
          <DialogTitle>Sync Projects</DialogTitle>
          <DialogDescription>Select the sources and processing options to run a manual sync.</DialogDescription>
        </DialogHeader>

        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-4 p-5">
            <div className="flex flex-col gap-4 rounded-lg border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex flex-col gap-1">
                  <h3 className="text-base font-semibold text-foreground">Sources</h3>
                  <p className="text-sm text-muted-foreground">Choose which feeds to include in this sync run.</p>
                </div>
                <Badge variant="outline">{selectedSourceCount} selected</Badge>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {SOURCES.map((src) => (
                  <div key={src.key} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
                    <Label htmlFor={`sync-source-${src.key}`} className="text-sm font-medium">{src.label}</Label>
                    <Switch
                      id={`sync-source-${src.key}`}
                      checked={selectedSources[src.key]}
                      onCheckedChange={sourceSetters[src.key]}
                      disabled={syncing}
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-4 rounded-lg border bg-card p-4">
              <div className="flex flex-col gap-1">
                <h3 className="text-base font-semibold text-foreground">Options</h3>
                <p className="text-sm text-muted-foreground">Adjust processing behavior for this one-off sync.</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
                  <Label htmlFor="sync-no-ai" className="text-sm font-medium">Skip AI Filter</Label>
                  <Switch id="sync-no-ai" checked={noAi} onCheckedChange={setNoAi} disabled={syncing} />
                </div>
                <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
                  <Label htmlFor="sync-include-expired" className="text-sm font-medium">Include Expired</Label>
                  <Switch id="sync-include-expired" checked={includeExpired} onCheckedChange={setIncludeExpired} disabled={syncing} />
                </div>
              </div>
            </div>

            {(logs.length > 0 || syncing) && (
              <div className="flex flex-col gap-3 rounded-lg border bg-card p-4">
                <div className="flex flex-col gap-1">
                  <h3 className="text-base font-semibold text-foreground">Live Status</h3>
                  <p className="text-sm text-muted-foreground">Stream output from the active sync process.</p>
                </div>
                <pre className="max-h-64 overflow-y-auto rounded-lg border bg-muted/40 p-4 font-mono text-xs leading-5 text-foreground">
                  {logs.length > 0 ? logs.join('\n') : (syncing ? 'Waiting for output...' : '')}
                  {syncing && <span className="text-primary">|</span>}
                  <span ref={logsEndRef} />
                </pre>
              </div>
            )}

            {result && (
              <div className={`flex flex-col gap-3 rounded-lg border p-4 ${result.success ? 'border-green-700/30 bg-green-50' : 'border-destructive/30 bg-destructive/5'}`}>
                <span className={`text-sm font-semibold ${result.success ? 'text-green-700' : 'text-destructive'}`}>
                  {result.success ? 'Success:' : 'Warning:'} {result.message}
                </span>
                {result.summary && (
                  <div className="flex flex-col gap-1.5 text-sm">
                    <div className="flex items-center justify-between gap-3"><span className="text-muted-foreground">Total scraped:</span><strong className="text-foreground">{result.summary.total_scraped}</strong></div>
                    <div className="flex items-center justify-between gap-3"><span className="text-muted-foreground">New projects:</span><strong className="text-foreground">{result.summary.new_projects}</strong></div>
                    <div className="flex items-center justify-between gap-3"><span className="text-muted-foreground">AI validated:</span><strong className="text-foreground">{result.summary.ai_verified}</strong></div>
                    <div className="flex items-center justify-between gap-3"><span className="text-muted-foreground">AI rejected:</span><strong className="text-foreground">{result.summary.ai_rejected}</strong></div>
                    <div className="flex items-center justify-between gap-3"><span className="text-muted-foreground">Total in DB:</span><strong className="text-foreground">{result.summary.total_projects}</strong></div>
                    {result.summary.scrapers && (
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        {Object.entries(result.summary.scrapers).map(([key, s]) => (
                          <div key={key} className={`rounded-lg border px-3 py-2 ${s.error ? 'border-destructive/30 bg-destructive/5' : 'border-green-700/30 bg-card'}`}>
                            <span className={`text-xs font-semibold ${s.error ? 'text-destructive' : 'text-green-700'}`}>{s.error ? 'Failed' : 'OK'} {s.label}</span>
                            <span className="block text-xs text-muted-foreground">{s.count} | {s.duration}s</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {!result.summary && result.project_count != null && (
                  <span className="text-sm font-semibold text-foreground">{result.project_count} projects</span>
                )}
              </div>
            )}
          </div>
        </ScrollArea>

        <DialogFooter className="border-t p-4">
          <div className="flex w-full items-center justify-between gap-3">
            <div className="flex flex-col">
              <strong className="text-sm text-foreground">{selectedSourceCount} source{selectedSourceCount === 1 ? '' : 's'} ready</strong>
              <span className="text-xs text-muted-foreground">Manual run with the current source and processing options.</span>
            </div>
            <div className="flex items-center gap-3">
              <Button type="button" variant="outline" onClick={onClose} disabled={syncing}>
                Close
              </Button>
              <Button type="button" onClick={handleSync} disabled={syncing || selectedSourceCount === 0}>
                {syncing ? <><LoaderCircle className="size-4 animate-spin" /> Running scrapers...</> : 'Run Sync'}
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
