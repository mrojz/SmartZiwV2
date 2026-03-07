import { useState, useEffect, useRef } from 'react';
import ClockTimePicker from './ClockTimePicker';
import { X, RefreshCw01 } from '@untitledui/icons';
import { Button } from '@/components/base/buttons/button';
import { Toggle } from '@/components/base/toggle/toggle';

function buildSyncStreamUrl() {
    const token = localStorage.getItem('pw_access_token');
    const params = new URLSearchParams();
    if (token) params.set('access_token', token);
    const query = params.toString();
    return query ? `/api/sync/stream?${query}` : '/api/sync/stream';
}

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
    { key: 'africagateway', label: 'Africa Gateway' },
];

const TIMEZONES = [
    { value: -12, label: 'UTC-12' },
    { value: -11, label: 'UTC-11' },
    { value: -10, label: 'UTC-10' },
    { value: -9, label: 'UTC-9' },
    { value: -8, label: 'UTC-8' },
    { value: -7, label: 'UTC-7' },
    { value: -6, label: 'UTC-6' },
    { value: -5, label: 'UTC-5' },
    { value: -4, label: 'UTC-4' },
    { value: -3, label: 'UTC-3' },
    { value: -2, label: 'UTC-2' },
    { value: -1, label: 'UTC-1' },
    { value: 0, label: 'UTC+0 (GMT)' },
    { value: 1, label: 'UTC+1 (CET)' },
    { value: 2, label: 'UTC+2' },
    { value: 3, label: 'UTC+3' },
    { value: 4, label: 'UTC+4' },
    { value: 5, label: 'UTC+5' },
    { value: 5.5, label: 'UTC+5:30 (IST)' },
    { value: 6, label: 'UTC+6' },
    { value: 7, label: 'UTC+7' },
    { value: 8, label: 'UTC+8' },
    { value: 9, label: 'UTC+9' },
    { value: 10, label: 'UTC+10' },
    { value: 11, label: 'UTC+11' },
    { value: 12, label: 'UTC+12' },
    { value: 13, label: 'UTC+13' },
    { value: 14, label: 'UTC+14' },
];

function computeTimeUntil(hour, minute, frequency, dayOfWeek) {
    const now = new Date();
    const target = new Date(now);
    target.setHours(hour, minute, 0, 0);

    if (frequency === 'weekly') {
        const dayMap = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 0 };
        const targetDay = dayMap[dayOfWeek] ?? 1;
        const currentDay = now.getDay();
        let daysUntil = targetDay - currentDay;
        if (daysUntil < 0 || (daysUntil === 0 && target <= now)) daysUntil += 7;
        target.setDate(target.getDate() + daysUntil);
    } else if (target <= now) {
        target.setDate(target.getDate() + 1);
    }

    const diffMs = target - now;
    const totalMins = Math.floor(diffMs / 60000);
    const hours = Math.floor(totalMins / 60);
    const mins = totalMins % 60;

    if (hours === 0 && mins === 0) return 'less than a minute';
    const parts = [];
    if (hours > 0) parts.push(`${hours}h`);
    if (mins > 0) parts.push(`${mins}m`);
    return parts.join(' ');
}

function formatCountdown(ms) {
    if (ms <= 0) return 'any moment now...';
    const totalSec = Math.floor(ms / 1000);
    const days = Math.floor(totalSec / 86400);
    const hours = Math.floor((totalSec % 86400) / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (mins > 0) parts.push(`${mins}m`);
    parts.push(`${secs}s`);
    return parts.join(' ');
}

function formatDateTime(iso) {
    if (!iso) return '?';
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    });
}

function formatDuration(startIso, endIso) {
    if (!startIso || !endIso) return '?';
    const ms = new Date(endIso) - new Date(startIso);
    const secs = Math.floor(ms / 1000);
    if (secs < 60) return `${secs}s`;
    const mins = Math.floor(secs / 60);
    const remSecs = secs % 60;
    return `${mins}m ${remSecs}s`;
}

function getErrorMessage(error, fallback) {
    if (!error) return fallback;
    return error?.message || fallback;
}

export default function SchedulePanel({ open, onClose, apiFetch }) {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [loadError, setLoadError] = useState('');
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
        timezone: 1,
    });
    const [nextRun, setNextRun] = useState(null);
    const [saveResult, setSaveResult] = useState(null);

    const [serverTime, setServerTime] = useState(null);
    const [serverOffset, setServerOffset] = useState(0);
    const [countdown, setCountdown] = useState(null);
    const timerRef = useRef(null);

    const [logs, setLogs] = useState([]);
    const [expandedLog, setExpandedLog] = useState(null);
    const [scraperLogData, setScraperLogData] = useState({});
    const [scraperLogTab, setScraperLogTab] = useState('summary');

    const [syncRunning, setSyncRunning] = useState(false);
    const [liveLogs, setLiveLogs] = useState([]);
    const liveLogEndRef = useRef(null);
    const sseRef = useRef(null);
    const liveLogIndexRef = useRef(-1);
    const syncPollRef = useRef(null);
    const [showClock, setShowClock] = useState(false);

    const hydrateLiveLogs = (lines = []) => {
        const nextLines = Array.isArray(lines) ? lines : [];
        liveLogIndexRef.current = nextLines.length - 1;
        setLiveLogs(nextLines);
    };

    const stopSyncStream = (clearLogs = false) => {
        if (sseRef.current) {
            sseRef.current.close();
            sseRef.current = null;
        }
        setSyncRunning(false);
        if (clearLogs) {
            liveLogIndexRef.current = -1;
            setLiveLogs([]);
        }
    };

    const startSyncStream = () => {
        if (sseRef.current) return;
        const es = new EventSource(buildSyncStreamUrl());
        sseRef.current = es;
        setSyncRunning(true);

        es.onmessage = (event) => {
            const data = JSON.parse(event.data);

            if (data.type === 'log') {
                const nextIndex = typeof data.index === 'number' ? data.index : liveLogIndexRef.current + 1;
                if (nextIndex <= liveLogIndexRef.current) return;
                liveLogIndexRef.current = nextIndex;
                setLiveLogs((prev) => [...prev, data.message]);
            } else if (data.type === 'done') {
                stopSyncStream(true);
                apiFetch('/api/schedule/logs')
                    .then((r) => (r.ok ? r.json() : []))
                    .then((fresh) => setLogs(Array.isArray(fresh) ? fresh : []))
                    .catch(() => { });
            }
        };

        es.onerror = () => {
            if (sseRef.current === es) {
                es.close();
                sseRef.current = null;
            }
        };
    };

    const syncFromStatus = (statusData) => {
        const running = Boolean(statusData?.running);
        const lines = Array.isArray(statusData?.lines) ? statusData.lines : [];

        if (running) {
            setSyncRunning(true);
            if (!sseRef.current) {
                hydrateLiveLogs(lines);
                startSyncStream();
            }
            return;
        }

        stopSyncStream(true);
    };

    const loadScheduleData = async () => {
        if (!apiFetch) return;
        setLoading(true);
        setLoadError('');
        setSaveResult(null);
        setExpandedLog(null);

        try {
            const [schedRes, timeRes, logsRes, statusRes] = await Promise.all([
                apiFetch('/api/schedule'),
                apiFetch('/api/server-time'),
                apiFetch('/api/schedule/logs'),
                apiFetch('/api/sync/status'),
            ]);

            if (!schedRes.ok || !timeRes.ok || !logsRes.ok || !statusRes.ok) {
                const responses = [schedRes, timeRes, logsRes, statusRes];
                const firstBad = responses.find((res) => !res.ok);
                const data = firstBad ? await firstBad.json().catch(() => ({})) : {};
                throw new Error(data?.detail || 'Failed to load schedule');
            }

            const [schedData, timeData, logsData, statusData] = await Promise.all([
                schedRes.json(),
                timeRes.json(),
                logsRes.json(),
                statusRes.json(),
            ]);

            setNextRun(schedData.next_run || null);
            delete schedData.next_run;
            setSchedule((prev) => ({ ...prev, ...schedData }));

            const serverMs = new Date(timeData.server_time).getTime();
            const localMs = Date.now();
            setServerOffset(serverMs - localMs);
            setServerTime(serverMs);

            setLogs(Array.isArray(logsData) ? logsData : []);
            syncFromStatus(statusData);
        } catch (error) {
            setLoadError(getErrorMessage(error, 'Failed to load schedule'));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (!open) {
            stopSyncStream(true);
            return;
        }
        loadScheduleData();
    }, [open]);

    useEffect(() => {
        if (!open || !apiFetch) return undefined;

        const poll = async () => {
            try {
                const res = await apiFetch('/api/sync/status');
                if (!res.ok) return;
                const statusData = await res.json();
                syncFromStatus(statusData);
            } catch {
                // Ignore polling errors and let the next tick retry.
            }
        };

        poll();
        syncPollRef.current = window.setInterval(poll, 3000);

        return () => {
            if (syncPollRef.current) {
                window.clearInterval(syncPollRef.current);
                syncPollRef.current = null;
            }
        };
    }, [open, apiFetch]);

    useEffect(() => {
        if (!open) {
            if (timerRef.current) clearInterval(timerRef.current);
            return;
        }

        timerRef.current = setInterval(() => {
            const now = Date.now() + serverOffset;
            setServerTime(now);

            if (nextRun) {
                const nextMs = new Date(nextRun).getTime();
                setCountdown(Math.max(0, nextMs - now));
            } else {
                setCountdown(null);
            }
        }, 1000);

        return () => clearInterval(timerRef.current);
    }, [open, serverOffset, nextRun]);

    useEffect(() => {
        if (liveLogs.length > 0) {
            liveLogEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
    }, [liveLogs]);

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
        if (!apiFetch) return;
        setSaving(true);
        setSaveResult(null);
        try {
            const res = await apiFetch('/api/schedule', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(schedule),
            });
            const data = await res.json().catch(() => ({}));
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

    const currentServerTimeStr = serverTime
        ? new Date(serverTime).toLocaleTimeString(undefined, {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
        })
        : '...';

    const tzLabel = TIMEZONES.find((tz) => tz.value === schedule.timezone)?.label || `UTC+${schedule.timezone}`;
    const timeUntilStr = computeTimeUntil(schedule.hour, schedule.minute, schedule.frequency, schedule.day_of_week);
    const selectedSourceCount = SOURCE_LIST.filter((src) => schedule.sources?.[src.key] ?? true).length;

    return (
        <div className="sync-overlay" onClick={onClose}>
            <div className="sync-panel schedule-panel-wide schedule-dialog" onClick={(e) => e.stopPropagation()}>
                <div className="sync-header sync-dialog-header">
                    <div className="sync-dialog-copy">
                        <h2>Sync Schedule</h2>
                        <p>Configure the automated sync cadence, sources, and processing options.</p>
                    </div>
                    <Button color="tertiary" size="sm" iconLeading={X} onPress={onClose} />
                </div>

                <div className="sync-body sync-dialog-body">
                    {loading ? (
                        <div className="schedule-loading">
                            <div className="spinner" />
                            <p>Loading schedule...</p>
                        </div>
                    ) : loadError ? (
                        <div className="config-state config-state-error schedule-error-state">
                            <p>{loadError}</p>
                            <Button color="secondary" size="sm" iconLeading={RefreshCw01} onPress={loadScheduleData}>Retry</Button>
                        </div>
                    ) : (
                        <>
                            {syncRunning && (
                                <div className="schedule-ongoing sync-card">
                                    <div className="schedule-ongoing-header">
                                        <span className="btn-spinner" />
                                        Sync in progress...
                                    </div>
                                    <pre className="schedule-ongoing-output">
                                        {liveLogs.length > 0
                                            ? liveLogs.slice(-30).join('\n')
                                            : 'Waiting for output...'}
                                        <div ref={liveLogEndRef} />
                                    </pre>
                                </div>
                            )}

                            <div className="sync-card schedule-overview-card">
                                <div className="sync-card-header">
                                    <div>
                                        <h3>Overview</h3>
                                        <p>Monitor server time, next run, and scheduler status.</p>
                                    </div>
                                </div>
                                <div className="schedule-overview-grid">
                                    <div className="schedule-overview-item">
                                        <span className="schedule-overview-label">Server time</span>
                                        <strong>{currentServerTimeStr}</strong>
                                    </div>
                                    <div className="schedule-overview-item">
                                        <span className="schedule-overview-label">Status</span>
                                        <strong>{schedule.enabled ? 'Enabled' : 'Disabled'}</strong>
                                    </div>
                                    <div className="schedule-overview-item">
                                        <span className="schedule-overview-label">Next run</span>
                                        <strong>{schedule.enabled && nextRun ? formatDateTime(nextRun) : 'Not scheduled'}</strong>
                                    </div>
                                </div>
                                <div className="schedule-overview-toggle">
                                    <Toggle
                                        isSelected={schedule.enabled}
                                        onChange={(val) => update('enabled', val)}
                                        label={schedule.enabled ? 'Scheduled sync enabled' : 'Scheduled sync disabled'}
                                        size="md"
                                    />
                                </div>
                                {schedule.enabled && countdown !== null && (
                                    <div className="schedule-next-run">
                                        <span className="meta-icon">?</span>
                                        Next run in <strong>{formatCountdown(countdown)}</strong>
                                    </div>
                                )}
                            </div>

                            <div className="sync-card">
                                <div className="sync-card-header">
                                    <div>
                                        <h3>Timing</h3>
                                        <p>Set the frequency, day, time, and timezone for scheduled syncs.</p>
                                    </div>
                                </div>
                                <div className="schedule-frequency-grid">
                                    <label className="schedule-field">
                                        <span>Frequency</span>
                                        <select
                                            value={schedule.frequency}
                                            onChange={(e) => update('frequency', e.target.value)}
                                            className="schedule-select"
                                        >
                                            <option value="daily">Daily</option>
                                            <option value="weekly">Weekly</option>
                                        </select>
                                    </label>

                                    {schedule.frequency === 'weekly' && (
                                        <label className="schedule-field">
                                            <span>Day</span>
                                            <select
                                                value={schedule.day_of_week}
                                                onChange={(e) => update('day_of_week', e.target.value)}
                                                className="schedule-select"
                                            >
                                                {DAYS.map((d) => (
                                                    <option key={d.value} value={d.value}>{d.label}</option>
                                                ))}
                                            </select>
                                        </label>
                                    )}

                                    <label className="schedule-field">
                                        <span>Time</span>
                                        <Button
                                            color="secondary"
                                            size="sm"
                                            className="schedule-time-btn"
                                            onPress={() => setShowClock(true)}
                                        >
                                            {String(schedule.hour).padStart(2, '0')}:{String(schedule.minute).padStart(2, '0')}
                                        </Button>
                                    </label>

                                    <label className="schedule-field schedule-field-wide">
                                        <span>Timezone</span>
                                        <select
                                            value={schedule.timezone}
                                            onChange={(e) => update('timezone', Number(e.target.value))}
                                            className="schedule-select schedule-tz-select"
                                        >
                                            {TIMEZONES.map((tz) => (
                                                <option key={tz.value} value={tz.value}>{tz.label}</option>
                                            ))}
                                        </select>
                                    </label>
                                </div>

                                {showClock && (
                                    <ClockTimePicker
                                        hour={schedule.hour}
                                        minute={schedule.minute}
                                        onConfirm={(h, m) => {
                                            update('hour', h);
                                            update('minute', m);
                                            setShowClock(false);
                                        }}
                                        onCancel={() => setShowClock(false)}
                                    />
                                )}

                                <div className="schedule-time-preview">
                                    ? Runs in <strong>{timeUntilStr}</strong> <span className="schedule-tz-note">({tzLabel})</span>
                                </div>
                            </div>

                            <div className="sync-card">
                                <div className="sync-card-header">
                                    <div>
                                        <h3>Sources</h3>
                                        <p>Choose which feeds the scheduler should include.</p>
                                    </div>
                                    <span className="sync-card-meta sync-card-meta-neutral">{selectedSourceCount} selected</span>
                                </div>
                                <div className="sync-source-grid">
                                    {SOURCE_LIST.map((src) => (
                                        <div key={src.key} className="sync-source-item">
                                            <Toggle
                                                isSelected={schedule.sources?.[src.key] ?? true}
                                                onChange={(val) => updateSource(src.key, val)}
                                                label={src.label}
                                            />
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="sync-card">
                                <div className="sync-card-header">
                                    <div>
                                        <h3>Options</h3>
                                        <p>Set additional rules applied during scheduled runs.</p>
                                    </div>
                                </div>
                                <div className="sync-options-grid">
                                    <div className="sync-option-item">
                                        <Toggle
                                            isSelected={schedule.no_ai}
                                            onChange={(val) => update('no_ai', val)}
                                            label="Skip AI Filter"
                                        />
                                    </div>
                                    <div className="sync-option-item">
                                        <Toggle
                                            isSelected={schedule.include_expired}
                                            onChange={(val) => update('include_expired', val)}
                                            label="Include Expired"
                                        />
                                    </div>
                                </div>
                            </div>

                            {saveResult && (
                                <div className={`sync-result ${saveResult.success ? 'success' : 'error'}`}>
                                    <div className="sync-result-header">
                                        <span>{saveResult.success ? 'Saved:' : 'Warning:'} {saveResult.message}</span>
                                    </div>
                                </div>
                            )}

                            <div className="sync-card schedule-history">
                                <div className="sync-card-header">
                                    <div>
                                        <h3>Run History</h3>
                                        <p>Review previous runs, durations, and scraper output.</p>
                                    </div>
                                </div>
                                {logs.length === 0 ? (
                                    <p className="schedule-no-logs">No scheduled runs yet.</p>
                                ) : (
                                    <div className="schedule-log-list">
                                        {logs.map((log, i) => (
                                            <div key={i} className={`schedule-log-entry ${log.success ? '' : 'failed'}`}>
                                                <div
                                                    className="schedule-log-header"
                                                    onClick={() => {
                                                        if (expandedLog === i) {
                                                            setExpandedLog(null);
                                                        } else {
                                                            setExpandedLog(i);
                                                            setScraperLogTab('summary');
                                                            if (!scraperLogData[i] && apiFetch) {
                                                                apiFetch(`/api/schedule/logs/${i}/scrapers`)
                                                                    .then(async (r) => {
                                                                        if (!r.ok) throw new Error('Failed to load scraper logs');
                                                                        return r.json();
                                                                    })
                                                                    .then((data) => setScraperLogData((prev) => ({ ...prev, [i]: data })))
                                                                    .catch(() => { });
                                                            }
                                                        }
                                                    }}
                                                >
                                                    <span className={`schedule-status-pill ${log.success ? 'success' : 'failed'}`}>
                                                        {log.success ? 'OK' : 'Failed'}
                                                    </span>
                                                    <span className="schedule-trigger-pill">
                                                        {log.trigger === 'scheduled' ? 'Auto' : 'Manual'}
                                                    </span>
                                                    <span className="schedule-log-date">{formatDateTime(log.started_at)}</span>
                                                    <span className="schedule-log-duration">{formatDuration(log.started_at, log.finished_at)}</span>
                                                    <span className="schedule-log-projects">{log.project_count ?? '?'} projects</span>
                                                    <span className="schedule-log-expand">{expandedLog === i ? '?' : '?'}</span>
                                                </div>
                                                {expandedLog === i && (
                                                    <div>
                                                        <div className="schedule-log-tabs">
                                                            <Button
                                                                color={scraperLogTab === 'summary' ? 'primary' : 'secondary'}
                                                                size="sm"
                                                                onPress={() => setScraperLogTab('summary')}
                                                            >
                                                                Summary
                                                            </Button>
                                                            {scraperLogData[i] && Object.entries(scraperLogData[i]).map(([key, s]) => (
                                                                <Button
                                                                    key={key}
                                                                    color={scraperLogTab === key ? 'primary' : 'secondary'}
                                                                    size="sm"
                                                                    onPress={() => setScraperLogTab(key)}
                                                                >
                                                                    {s.label || key}
                                                                </Button>
                                                            ))}
                                                        </div>
                                                        <pre className="schedule-log-output">
                                                            {scraperLogTab === 'summary'
                                                                ? (log.log_lines || []).join('\n') || '(no output)'
                                                                : (scraperLogData[i]?.[scraperLogTab]?.output || []).join('\n') || '(no output)'}
                                                        </pre>
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </>
                    )}
                </div>

                <div className="sync-footer">
                    <div className="sync-footer-meta">
                        <span>{schedule.enabled ? 'Schedule enabled' : 'Schedule disabled'}</span>
                    </div>
                    <div className="sync-footer-actions">
                        <Button color="secondary" onPress={onClose} isDisabled={saving}>Close</Button>
                        <Button
                            color="primary"
                            className="sync-primary-btn"
                            onPress={handleSave}
                            isDisabled={saving || !!loadError}
                            isLoading={saving}
                        >
                            Save Schedule
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}
