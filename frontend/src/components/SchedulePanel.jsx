import { useState, useEffect } from 'react';

const DAYS = [
    { value: 'mon', label: 'Monday' },
    { value: 'tue', label: 'Tuesday' },
    { value: 'wed', label: 'Wednesday' },
    { value: 'thu', label: 'Thursday' },
    { value: 'fri', label: 'Friday' },
    { value: 'sat', label: 'Saturday' },
    { value: 'sun', label: 'Sunday' },
];

const SOURCE_LIST = [
    { key: 'iadb', label: 'IADB' },
    { key: 'worldbank', label: 'World Bank' },
    { key: 'globaltenders', label: 'Global Tenders' },
    { key: 'giz', label: 'GIZ' },
    { key: 'devaid', label: 'DevelopmentAid' },
    { key: 'dgmarket', label: 'DGMarket' },
];

export default function SchedulePanel({ open, onClose }) {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [schedule, setSchedule] = useState({
        enabled: false,
        frequency: 'daily',
        day_of_week: 'mon',
        hour: 6,
        minute: 0,
        sources: {
            iadb: true,
            worldbank: true,
            globaltenders: true,
            giz: true,
            devaid: true,
            dgmarket: true,
        },
        no_ai: false,
        include_expired: false,
    });
    const [nextRun, setNextRun] = useState(null);
    const [saveResult, setSaveResult] = useState(null);

    useEffect(() => {
        if (!open) return;
        setLoading(true);
        setSaveResult(null);
        fetch('/api/schedule')
            .then((r) => r.json())
            .then((data) => {
                setNextRun(data.next_run || null);
                delete data.next_run;
                setSchedule((prev) => ({ ...prev, ...data }));
            })
            .catch(() => { })
            .finally(() => setLoading(false));
    }, [open]);

    if (!open) return null;

    const update = (field, value) => {
        setSchedule((prev) => ({ ...prev, [field]: value }));
    };

    const updateSource = (key, checked) => {
        setSchedule((prev) => ({
            ...prev,
            sources: { ...prev.sources, [key]: checked },
        }));
    };

    const handleSave = async () => {
        setSaving(true);
        setSaveResult(null);
        try {
            const res = await fetch('/api/schedule', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(schedule),
            });
            const data = await res.json();
            if (res.ok) {
                setNextRun(data.next_run || null);
                setSaveResult({ success: true, message: 'Schedule saved!' });
            } else {
                setSaveResult({ success: false, message: data.detail || 'Failed to save' });
            }
        } catch (err) {
            setSaveResult({ success: false, message: 'Network error: ' + err.message });
        } finally {
            setSaving(false);
        }
    };

    const formatNextRun = (iso) => {
        if (!iso) return 'Not scheduled';
        const d = new Date(iso);
        return d.toLocaleString(undefined, {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    };

    return (
        <div className="sync-overlay" onClick={onClose}>
            <div className="sync-panel" onClick={(e) => e.stopPropagation()}>
                <div className="sync-header">
                    <h2>📅 Sync Schedule</h2>
                    <button className="sync-close" onClick={onClose}>✕</button>
                </div>

                <div className="sync-body">
                    {loading ? (
                        <div className="schedule-loading">
                            <div className="spinner" />
                            <p>Loading schedule…</p>
                        </div>
                    ) : (
                        <>
                            {/* Enable toggle */}
                            <div className="sync-section">
                                <label className="sync-toggle schedule-enable">
                                    <input
                                        type="checkbox"
                                        checked={schedule.enabled}
                                        onChange={(e) => update('enabled', e.target.checked)}
                                    />
                                    <span className="toggle-label">
                                        {schedule.enabled ? '✅ Scheduled sync enabled' : '⏸️ Scheduled sync disabled'}
                                    </span>
                                </label>
                            </div>

                            {/* Next run info */}
                            {schedule.enabled && nextRun && (
                                <div className="schedule-next-run">
                                    <span className="meta-icon">⏰</span>
                                    Next run: <strong>{formatNextRun(nextRun)}</strong>
                                </div>
                            )}

                            {/* Frequency */}
                            <div className="sync-section">
                                <h3>Frequency</h3>
                                <div className="schedule-frequency">
                                    <select
                                        value={schedule.frequency}
                                        onChange={(e) => update('frequency', e.target.value)}
                                        className="schedule-select"
                                    >
                                        <option value="daily">Daily</option>
                                        <option value="weekly">Weekly</option>
                                    </select>

                                    {schedule.frequency === 'weekly' && (
                                        <select
                                            value={schedule.day_of_week}
                                            onChange={(e) => update('day_of_week', e.target.value)}
                                            className="schedule-select"
                                        >
                                            {DAYS.map((d) => (
                                                <option key={d.value} value={d.value}>{d.label}</option>
                                            ))}
                                        </select>
                                    )}

                                    <span className="schedule-at">at</span>

                                    <input
                                        type="time"
                                        value={`${String(schedule.hour).padStart(2, '0')}:${String(schedule.minute).padStart(2, '0')}`}
                                        onChange={(e) => {
                                            const [h, m] = e.target.value.split(':').map(Number);
                                            update('hour', h);
                                            update('minute', m);
                                        }}
                                        className="schedule-time"
                                    />
                                </div>
                            </div>

                            {/* Sources */}
                            <div className="sync-section">
                                <h3>Sources</h3>
                                {SOURCE_LIST.map((src) => (
                                    <label key={src.key} className="sync-toggle">
                                        <input
                                            type="checkbox"
                                            checked={schedule.sources?.[src.key] ?? true}
                                            onChange={(e) => updateSource(src.key, e.target.checked)}
                                        />
                                        <span className="toggle-label">{src.label}</span>
                                    </label>
                                ))}
                            </div>

                            {/* Options */}
                            <div className="sync-section">
                                <h3>Options</h3>
                                <label className="sync-toggle">
                                    <input
                                        type="checkbox"
                                        checked={schedule.no_ai}
                                        onChange={(e) => update('no_ai', e.target.checked)}
                                    />
                                    <span className="toggle-label">Skip AI Filter</span>
                                </label>
                                <label className="sync-toggle">
                                    <input
                                        type="checkbox"
                                        checked={schedule.include_expired}
                                        onChange={(e) => update('include_expired', e.target.checked)}
                                    />
                                    <span className="toggle-label">Include Expired</span>
                                </label>
                            </div>

                            {/* Save button */}
                            <button
                                className={`sync-run-btn ${saving ? 'syncing' : ''}`}
                                onClick={handleSave}
                                disabled={saving}
                            >
                                {saving ? (
                                    <>
                                        <span className="btn-spinner" />
                                        Saving…
                                    </>
                                ) : (
                                    '💾 Save Schedule'
                                )}
                            </button>

                            {saveResult && (
                                <div className={`sync-result ${saveResult.success ? 'success' : 'error'}`}>
                                    <div className="sync-result-header">
                                        <span>{saveResult.success ? '✅' : '⚠️'} {saveResult.message}</span>
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
