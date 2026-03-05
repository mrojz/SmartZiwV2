import { useState, useRef } from 'react';
import { X } from '@untitledui/icons';
import { Button } from '@/components/base/buttons/button';
import { Toggle } from '@/components/base/toggle/toggle';
import { BadgeWithDot } from '@/components/base/badges/badges';

export default function SyncPanel({ open, onClose, onSyncDone, onSyncStart }) {
  const [iadb, setIadb] = useState(true);
  const [worldbank, setWorldbank] = useState(true);
  const [globaltenders, setGlobaltenders] = useState(true);
  const [giz, setGiz] = useState(true);
  const [devaid, setDevaid] = useState(true);
  const [dgmarket, setDgmarket] = useState(true);
  const [africagateway, setAfricagateway] = useState(true);
  const [noAi, setNoAi] = useState(false);
  const [includeExpired, setIncludeExpired] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [logs, setLogs] = useState([]);
  const [result, setResult] = useState(null);
  const logsEndRef = useRef(null);

  if (!open) return null;

  const scrollToBottom = () => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleSync = async () => {
    setSyncing(true);
    setLogs([]);
    setResult(null);
    onSyncStart?.();

    try {
      const startRes = await fetch('/api/sync/manual', {
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

      const eventSource = new EventSource('/api/sync/stream');
      eventSource.onmessage = (event) => {
        const data = JSON.parse(event.data);

        if (data.type === 'log') {
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
          eventSource.close();
          onSyncDone();
        }
      };

      eventSource.onerror = () => {
        eventSource.close();
        setSyncing(false);
        setResult({ success: false, message: 'Connection to sync stream lost' });
      };
    } catch (err) {
      setResult({ success: false, message: `Network error: ${err.message}` });
      setSyncing(false);
    }
  };

  return (
    <div className="sync-overlay" onClick={onClose}>
      <div className="sync-panel" onClick={(e) => e.stopPropagation()}>
        <div className="sync-header">
          <h2>Sync Projects</h2>
          <Button color="tertiary" size="sm" iconLeading={X} onPress={onClose} />
        </div>

        <div className="sync-body">
          <div className="sync-section">
            <h3>Sources</h3>
            <Toggle isSelected={iadb} onChange={setIadb} isDisabled={syncing} label="IADB" />
            <Toggle isSelected={worldbank} onChange={setWorldbank} isDisabled={syncing} label="World Bank" />
            <Toggle isSelected={globaltenders} onChange={setGlobaltenders} isDisabled={syncing} label="Global Tenders" />
            <Toggle isSelected={giz} onChange={setGiz} isDisabled={syncing} label="GIZ" />
            <Toggle isSelected={devaid} onChange={setDevaid} isDisabled={syncing} label="DevelopmentAid" />
            <Toggle isSelected={dgmarket} onChange={setDgmarket} isDisabled={syncing} label="DGMarket" />
            <Toggle isSelected={africagateway} onChange={setAfricagateway} isDisabled={syncing} label="Africa Gateway" />
          </div>

          <div className="sync-section">
            <h3>Options</h3>
            <Toggle isSelected={noAi} onChange={setNoAi} isDisabled={syncing} label="Skip AI Filter" />
            <Toggle isSelected={includeExpired} onChange={setIncludeExpired} isDisabled={syncing} label="Include Expired" />
          </div>

          <Button
            color="primary"
            className="w-full"
            onPress={handleSync}
            isDisabled={syncing || (!iadb && !worldbank && !globaltenders && !giz && !devaid && !dgmarket && !africagateway)}
            isLoading={syncing}
          >
            {syncing ? 'Running scrapers...' : 'Run Sync'}
          </Button>

          {(logs.length > 0 || syncing) && (
            <div className="sync-logs">
              <h3>Live Status</h3>
              <pre className="sync-output">
                {logs.map((line, i) => (
                  <div key={i}>{line}</div>
                ))}
                {syncing && <div className="sync-cursor">|</div>}
                <div ref={logsEndRef} />
              </pre>
            </div>
          )}

          {result && (
            <div className={`sync-result ${result.success ? 'success' : 'error'}`}>
              <div className="sync-result-header">
                <span>{result.success ? 'Success:' : 'Warning:'} {result.message}</span>
              </div>
              {result.summary && (
                <div className="sync-summary">
                  <div className="sync-summary-row">
                    <span>Total scraped:</span>
                    <strong>{result.summary.total_scraped}</strong>
                  </div>
                  <div className="sync-summary-row">
                    <span>New projects:</span>
                    <strong>{result.summary.new_projects}</strong>
                  </div>
                  <div className="sync-summary-row">
                    <span>AI validated:</span>
                    <strong>{result.summary.ai_verified}</strong>
                  </div>
                  <div className="sync-summary-row">
                    <span>AI rejected:</span>
                    <strong>{result.summary.ai_rejected}</strong>
                  </div>
                  <div className="sync-summary-row">
                    <span>Total in DB:</span>
                    <strong>{result.summary.total_projects}</strong>
                  </div>
                  {result.summary.scrapers && (
                    <div className="sync-scrapers-grid">
                      {Object.entries(result.summary.scrapers).map(([key, s]) => (
                        <div key={key} className={`sync-scraper-chip ${s.error ? 'failed' : 'ok'}`}>
                          <span>{s.error ? 'Failed' : 'OK'} {s.label}</span>
                          <span className="chip-count">{s.count} | {s.duration}s</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {!result.summary && result.project_count != null && (
                <div className="sync-result-header">
                  <span className="sync-count">{result.project_count} projects</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
