import { useState, useEffect, useRef } from 'react';
import ClockTimePicker from './ClockTimePicker';
import { X } from '@untitledui/icons';
import { Button } from '@/components/base/buttons/button';
import { Toggle } from '@/components/base/toggle/toggle';
import { Badge, BadgeWithDot } from '@/components/base/badges/badges';

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
    } else {
        if (target <= now) target.setDate(target.getDate() + 1);
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
    if (ms <= 0) return 'any moment now…';
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
    if (!iso) return '—';
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
    if (!startIso || !endIso) return '—';
    const ms = new Date(endIso) - new Date(startIso);
    const secs = Math.floor(ms / 1000);
    if (secs < 60) return `${secs}s`;
    const mins = Math.floor(secs / 60);
    const remSecs = secs % 60;
    return `${mins}m ${remSecs}s`;
}

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
    const [showClock, setShowClock] = useState(false);

    useEffect(() => {
        if (!open) {
            if (sseRef.current) {
                sseRef.current.close();
                sseRef.current = null;
            }
            return;
        }
        setLoading(true);
        setSaveResult(null);
        setExpandedLog(null);

        Promise.all([
            fetch('/api/schedule').then((r) => r.json()),
            fetch('/api/server-time').then((r) => r.json()),
            fetch('/api/schedule/logs').then((r) => r.json()),
            fetch('/api/sync/status').then((r) => r.json()),
        ])
            .then(([schedData, timeData, logsData, statusData]) => {
                setNextRun(schedData.next_run || null);
                delete schedData.next_run;
                setSchedule((prev) => ({ ...prev, ...schedData }));

                const serverMs = new Date(timeData.server_time).getTime();
                const localMs = Date.now();
                setServerOffset(serverMs - localMs);
                setServerTime(serverMs);

                setLogs(Array.isArray(logsData) ? logsData : []);

                if (statusData.running) {
                    setSyncRunning(true);
                    setLiveLogs([]);
                    const es = new EventSource('/api/sync/stream');
                    sseRef.current = es;

                    es.onmessage = (event) => {
                        const data = JSON.parse(event.data);
                        if (data.type === 'log') {
                            setLiveLogs((prev) => [...prev, data.message]);
                        } else if (data.type === 'done') {
                            setSyncRunning(false);
                            es.close();
                            sseRef.current = null;
                            fetch('/api/schedule/logs')
                                .then((r) => r.json())
                                .then((fresh) => setLogs(Array.isArray(fresh) ? fresh : []))
                                .catch(() => { });
                        }
                    };

                    es.onerror = () => {
                        setSyncRunning(false);
                        es.close();
                        sseRef.current = null;
                    };
                } else {
                    setSyncRunning(false);
                    setLiveLogs([]);
                }
            })
            .catch(() => { })
            .finally(() => setLoading(false));
    }, [open]);

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

    const currentServerTimeStr = serverTime
        ? new Date(serverTime).toLocaleTimeString(undefined, {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
        })
        : '…';

    const tzLabel = TIMEZONES.find((tz) => tz.value === schedule.timezone)?.label || `UTC+${schedule.timezone}`;
    const timeUntilStr = computeTimeUntil(schedule.hour, schedule.minute, schedule.frequency, schedule.day_of_week);

    return (
        <div className="sync-overlay" onClick={onClose}>
            <div className="sync-panel schedule-panel-wide" onClick={(e) => e.stopPropagation()}>
                <div className="sync-header">
                    <h2>Sync Schedule</h2>
                    <Button color="tertiary" size="sm" iconLeading={X} onPress={onClose} />
                </div>

                <div className="sync-body">
                    {loading ? (
                        <div className="schedule-loading">
                            <div className="spinner" />
                            <p>Loading schedule…</p>
                        </div>
                    ) : (
                        <>
                            {syncRunning && (
                                <div className="schedule-ongoing">
                                    <div className="schedule-ongoing-header">
                                        <span className="btn-spinner" />
                                        Sync in progress…
                                    </div>
                                    <pre className="schedule-ongoing-output">
                                        {liveLogs.length > 0
                                            ? liveLogs.slice(-30).join('\n')
                                            : 'Waiting for output…'}
                                        <div ref={liveLogEndRef} />
                                    </pre>
                                </div>
                            )}

                            <div className="schedule-server-time">
                                <span>Server time: <strong>{currentServerTimeStr}</strong></span>
                                {schedule.enabled && countdown !== null && (
                                    <span className="schedule-countdown">
                                        Next run in: <strong>{formatCountdown(countdown)}</strong>
                                    </span>
                                )}
                            </div>

                            <div className="sync-section">
                                <Toggle
                                    isSelected={schedule.enabled}
                                    onChange={(val) => update('enabled', val)}
                                    label={schedule.enabled ? 'Scheduled sync enabled' : 'Scheduled sync disabled'}
                                    size="md"
                                />
                            </div>

                            {schedule.enabled && nextRun && (
                                <div className="schedule-next-run">
                                    <span className="meta-icon">⏰</span>
                                    Next run: <strong>{formatDateTime(nextRun)}</strong>
                                </div>
                            )}

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

                                    <Button
                                        color="secondary"
                                        size="sm"
                                        onPress={() => setShowClock(true)}
                                    >
                                        {String(schedule.hour).padStart(2, '0')}:{String(schedule.minute).padStart(2, '0')}
                                    </Button>

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

                                    <select
                                        value={schedule.timezone}
                                        onChange={(e) => update('timezone', Number(e.target.value))}
                                        className="schedule-select schedule-tz-select"
                                    >
                                        {TIMEZONES.map((tz) => (
                                            <option key={tz.value} value={tz.value}>{tz.label}</option>
                                        ))}
                                    </select>
                                </div>

                                <div className="schedule-time-preview">
                                    ⏱ Runs in <strong>{timeUntilStr}</strong> <span className="schedule-tz-note">({tzLabel})</span>
                                </div>
                            </div>

                            <div className="sync-section">
                                <h3>Sources</h3>
                                {SOURCE_LIST.map((src) => (
                                    <Toggle
                                        key={src.key}
                                        isSelected={schedule.sources?.[src.key] ?? true}
                                        onChange={(val) => updateSource(src.key, val)}
                                        label={src.label}
                                    />
                                ))}
                            </div>

                            <div className="sync-section">
                                <h3>Options</h3>
                                <Toggle
                                    isSelected={schedule.no_ai}
                                    onChange={(val) => update('no_ai', val)}
                                    label="Skip AI Filter"
                                />
                                <Toggle
                                    isSelected={schedule.include_expired}
                                    onChange={(val) => update('include_expired', val)}
                                    label="Include Expired"
                                />
                            </div>

                            <Button
                                color="primary"
                                className="w-full"
                                onPress={handleSave}
                                isDisabled={saving}
                                isLoading={saving}
                            >
                                Save Schedule
                            </Button>

                            {saveResult && (
                                <div className={`sync-result ${saveResult.success ? 'success' : 'error'}`}>
                                    <div className="sync-result-header">
                                        <span>{saveResult.success ? 'Saved:' : 'Warning:'} {saveResult.message}</span>
                                    </div>
                                </div>
                            )}

                            {/* ── Run History ────────────────────────────────── */}
                            <div className="sync-section schedule-history">
                                <h3>Run History</h3>
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
                                                            if (!scraperLogData[i]) {
                                                                fetch(`/api/schedule/logs/${i}/scrapers`)
                                                                    .then((r) => r.json())
                                                                    .then((data) => setScraperLogData((prev) => ({ ...prev, [i]: data })))
                                                                    .catch(() => { });
                                                            }
                                                        }
                                                    }}
                                                >
                                                    <BadgeWithDot color={log.success ? 'success' : 'error'} size="sm">
                                                        {log.success ? 'OK' : 'Failed'}
                                                    </BadgeWithDot>
                                                    <Badge color={log.trigger === 'scheduled' ? 'brand' : 'gray'} size="sm">
                                                        {log.trigger === 'scheduled' ? 'Auto' : 'Manual'}
                                                    </Badge>
                                                    <span className="schedule-log-date">
                                                        {formatDateTime(log.started_at)}
                                                    </span>
                                                    <span className="schedule-log-duration">
                                                        {formatDuration(log.started_at, log.finished_at)}
                                                    </span>
                                                    <span className="schedule-log-projects">
                                                        {log.project_count ?? '—'} projects
                                                    </span>
                                                    <span className="schedule-log-expand">
                                                        {expandedLog === i ? '▲' : '▼'}
                                                    </span>
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
            </div>
        </div>
    );
}
