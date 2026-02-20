import { useState, useRef } from 'react';

export default function SyncPanel({ open, onClose, onSyncDone, onSyncStart }) {
    const [iadb, setIadb] = useState(true);
    const [worldbank, setWorldbank] = useState(true);
    const [globaltenders, setGlobaltenders] = useState(true);
    const [giz, setGiz] = useState(true);
    const [devaid, setDevaid] = useState(true);
    const [dgmarket, setDgmarket] = useState(true);
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
            // 1. Start the sync
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

            // 2. Stream logs via SSE
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
            setResult({ success: false, message: 'Network error: ' + err.message });
            setSyncing(false);
        }
    };

    return (
        <div className="sync-overlay" onClick={onClose}>
            <div className="sync-panel" onClick={(e) => e.stopPropagation()}>
                <div className="sync-header">
                    <h2>🔄 Sync Projects</h2>
                    <button className="sync-close" onClick={onClose}>✕</button>
                </div>

                <div className="sync-body">
                    <div className="sync-section">
                        <h3>Sources</h3>
                        <label className="sync-toggle">
                            <input type="checkbox" checked={iadb} onChange={(e) => setIadb(e.target.checked)} disabled={syncing} />
                            <span className="toggle-label">IADB</span>
                        </label>
                        <label className="sync-toggle">
                            <input type="checkbox" checked={worldbank} onChange={(e) => setWorldbank(e.target.checked)} disabled={syncing} />
                            <span className="toggle-label">World Bank</span>
                        </label>
                        <label className="sync-toggle">
                            <input type="checkbox" checked={globaltenders} onChange={(e) => setGlobaltenders(e.target.checked)} disabled={syncing} />
                            <span className="toggle-label">Global Tenders</span>
                        </label>
                        <label className="sync-toggle">
                            <input type="checkbox" checked={giz} onChange={(e) => setGiz(e.target.checked)} disabled={syncing} />
                            <span className="toggle-label">GIZ</span>
                        </label>
                        <label className="sync-toggle">
                            <input type="checkbox" checked={devaid} onChange={(e) => setDevaid(e.target.checked)} disabled={syncing} />
                            <span className="toggle-label">DevelopmentAid</span>
                        </label>
                        <label className="sync-toggle">
                            <input type="checkbox" checked={dgmarket} onChange={(e) => setDgmarket(e.target.checked)} disabled={syncing} />
                            <span className="toggle-label">DGMarket</span>
                        </label>
                    </div>

                    <div className="sync-section">
                        <h3>Options</h3>
                        <label className="sync-toggle">
                            <input type="checkbox" checked={noAi} onChange={(e) => setNoAi(e.target.checked)} disabled={syncing} />
                            <span className="toggle-label">Skip AI Filter</span>
                        </label>
                        <label className="sync-toggle">
                            <input type="checkbox" checked={includeExpired} onChange={(e) => setIncludeExpired(e.target.checked)} disabled={syncing} />
                            <span className="toggle-label">Include Expired</span>
                        </label>
                    </div>

                    <button
                        className={`sync-run-btn ${syncing ? 'syncing' : ''}`}
                        onClick={handleSync}
                        disabled={syncing || (!iadb && !worldbank && !globaltenders && !giz && !devaid && !dgmarket)}
                    >
                        {syncing ? (
                            <>
                                <span className="btn-spinner" />
                                Running scrapers…
                            </>
                        ) : (
                            '▶ Run Sync'
                        )}
                    </button>

                    {/* Live log output */}
                    {(logs.length > 0 || syncing) && (
                        <div className="sync-logs">
                            <h3>Live Output</h3>
                            <pre className="sync-output">
                                {logs.map((line, i) => (
                                    <div key={i}>{line}</div>
                                ))}
                                {syncing && <div className="sync-cursor">▌</div>}
                                <div ref={logsEndRef} />
                            </pre>
                        </div>
                    )}

                    {result && (
                        <div className={`sync-result ${result.success ? 'success' : 'error'}`}>
                            <div className="sync-result-header">
                                <span>{result.success ? '✅' : '⚠️'} {result.message}</span>
                                {result.project_count != null && (
                                    <span className="sync-count">{result.project_count} projects</span>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
