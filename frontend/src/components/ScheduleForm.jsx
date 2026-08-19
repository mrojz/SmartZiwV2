import { useState, useEffect, useRef } from 'react';
import ClockTimePicker from './ClockTimePicker';
import { RefreshCw, LoaderCircle, Info } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

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
    { key: 'isdb', label: 'IsDB' },
    { key: 'badea', label: 'BADEA' },
    { key: 'bcie', label: 'BCIE' },
    { key: 'eabr', label: 'EABR' },
    { key: 'oas', label: 'OAS' },
    { key: 'africanunion', label: 'African Union' },
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

function formatUtcOffsetLabel(offset) {
    const value = Number(offset) || 0;
    const sign = value >= 0 ? '+' : '-';
    const abs = Math.abs(value);
    const hours = Math.floor(abs);
    const minutes = Math.round((abs - hours) * 60);
    if (minutes === 0) return `UTC${sign}${hours}`;
    return `UTC${sign}${hours}:${String(minutes).padStart(2, '0')}`;
}

function convertToServerSchedule(hour, minute, selectedOffset, serverOffset, frequency, dayOfWeek) {
    let totalMinutes = (Number(hour) * 60) + Number(minute) + ((Number(serverOffset) - Number(selectedOffset)) * 60);
    let dayShift = 0;

    while (totalMinutes < 0) {
        totalMinutes += 1440;
        dayShift -= 1;
    }
    while (totalMinutes >= 1440) {
        totalMinutes -= 1440;
        dayShift += 1;
    }

    const dayOrder = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
    const dayLabels = {
        mon: 'Monday',
        tue: 'Tuesday',
        wed: 'Wednesday',
        thu: 'Thursday',
        fri: 'Friday',
        sat: 'Saturday',
        sun: 'Sunday',
    };
    const result = {
        hour: Math.floor(totalMinutes / 60),
        minute: totalMinutes % 60,
        dayLabel: '',
        dayShift,
    };

    if (frequency === 'weekly') {
        const currentIndex = dayOrder.indexOf(dayOfWeek);
        const nextIndex = currentIndex === -1 ? 0 : (currentIndex + dayShift + 7) % 7;
        result.dayLabel = dayLabels[dayOrder[nextIndex]];
    }

    return result;
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
    if (!iso) return '-';
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
    if (!startIso || !endIso) return '-';
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

export default function ScheduleForm({ apiFetch, onBack }) {
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
            africagateway: true,
            isdb: true,
            badea: true,
            bcie: true,
            eabr: true,
            oas: true,
            africanunion: true,
        },
        no_ai: false,
        include_expired: false,
        timezone: 1,
    });
    const [nextRun, setNextRun] = useState(null);
    const [saveResult, setSaveResult] = useState(null);

    const [serverTime, setServerTime] = useState(null);
    const [serverOffset, setServerOffset] = useState(0);
    const [serverTimezoneOffset, setServerTimezoneOffset] = useState(0);
    const [countdown, setCountdown] = useState(null);
    const timerRef = useRef(null);

    const [logs, setLogs] = useState([]);
    const [expandedLog, setExpandedLog] = useState(null);
    const [scraperLogData, setScraperLogData] = useState({});
    const [scraperLogTab, setScraperLogTab] = useState('summary');

    const [syncRunning, setSyncRunning] = useState(false);
    const [liveLogs, setLiveLogs] = useState([]);
    const liveLogContainerRef = useRef(null);
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
                stopSyncStream(false);
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

        if (lines.length > 0) {
            hydrateLiveLogs(lines);
        }
        stopSyncStream(false);
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
            setServerTimezoneOffset(Number(timeData.server_timezone_offset_hours ?? 0));

            setLogs(Array.isArray(logsData) ? logsData : []);
            syncFromStatus(statusData);
        } catch (error) {
            setLoadError(getErrorMessage(error, 'Failed to load schedule'));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadScheduleData();
    }, []);

    useEffect(() => {
        if (!apiFetch) return undefined;

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
    }, [apiFetch]);

    useEffect(() => {
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
    }, [serverOffset, nextRun]);

    useEffect(() => {
        if (liveLogs.length > 0 && liveLogContainerRef.current) {
            liveLogContainerRef.current.scrollTop = liveLogContainerRef.current.scrollHeight;
        }
    }, [liveLogs]);

    useEffect(() => {
        return () => stopSyncStream(true);
    }, []);

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
    const translatedServerSchedule = convertToServerSchedule(
        schedule.hour,
        schedule.minute,
        schedule.timezone,
        serverTimezoneOffset,
        schedule.frequency,
        schedule.day_of_week,
    );
    const serverExecutionTime = `${String(translatedServerSchedule.hour).padStart(2, '0')}:${String(translatedServerSchedule.minute).padStart(2, '0')}`;
    const serverExecutionLabel = translatedServerSchedule.dayLabel
        ? `${translatedServerSchedule.dayLabel} at ${serverExecutionTime}`
        : serverExecutionTime;
    const selectedSourceCount = SOURCE_LIST.filter((src) => schedule.sources?.[src.key] ?? true).length;

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <ScrollArea className="min-h-0 flex-1">
                <div className="flex flex-col gap-4 p-6">
                    {loading ? (
                        <div className="flex flex-col items-center justify-center gap-3 py-16">
                            <LoaderCircle className="size-6 animate-spin text-muted-foreground" />
                            <p className="text-sm text-muted-foreground">Loading schedule...</p>
                        </div>
                    ) : loadError ? (
                        <div className="flex flex-col items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-center">
                            <p className="text-sm text-destructive">{loadError}</p>
                            <Button type="button" variant="outline" size="sm" onClick={loadScheduleData}>
                                <RefreshCw />
                                Retry
                            </Button>
                        </div>
                    ) : (
                        <>
                            {(syncRunning || liveLogs.length > 0) && (
                                <div className="flex flex-col gap-3 rounded-lg border bg-card p-6">
                                    <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                                        {syncRunning && <LoaderCircle className="size-4 animate-spin text-primary" />}
                                        {syncRunning ? 'Sync in progress...' : 'Recent sync output'}
                                    </div>
                                    <pre ref={liveLogContainerRef} className="max-h-48 overflow-y-auto rounded-lg border bg-muted/40 p-4 font-mono text-xs leading-5 text-foreground">
                                        {liveLogs.length > 0
                                            ? liveLogs.slice(-30).join('\n')
                                            : 'Waiting for output...'}
                                    </pre>
                                </div>
                            )}

                            <div className="flex flex-col gap-4 rounded-lg border bg-card p-6">
                                <div className="flex flex-col gap-1">
                                    <h3 className="text-base font-semibold text-foreground">Overview</h3>
                                    <p className="text-sm text-muted-foreground">Monitor server time, next run, and scheduler status.</p>
                                </div>
                                <div className="grid gap-4 sm:grid-cols-3">
                                    <div className="flex flex-col gap-0.5">
                                        <span className="text-xs text-muted-foreground">Server time</span>
                                        <strong className="text-sm font-semibold text-foreground">{currentServerTimeStr}</strong>
                                    </div>
                                    <div className="flex flex-col gap-0.5">
                                        <span className="text-xs text-muted-foreground">Status</span>
                                        <strong className="text-sm font-semibold text-foreground">{schedule.enabled ? 'Enabled' : 'Disabled'}</strong>
                                    </div>
                                    <div className="flex flex-col gap-0.5">
                                        <span className="text-xs text-muted-foreground">Next run</span>
                                        <strong className="text-sm font-semibold text-foreground">{schedule.enabled && nextRun ? formatDateTime(nextRun) : 'Not scheduled'}</strong>
                                    </div>
                                </div>
                                <div className="flex items-center justify-between gap-3 rounded-lg border px-4 py-3">
                                    <Label htmlFor="schedule-enabled" className="text-sm font-semibold">
                                        {schedule.enabled ? 'Scheduled sync enabled' : 'Scheduled sync disabled'}
                                    </Label>
                                    <Switch
                                        id="schedule-enabled"
                                        checked={schedule.enabled}
                                        onCheckedChange={(val) => update('enabled', val)}
                                    />
                                </div>
                                {schedule.enabled && countdown !== null && (
                                    <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                                        <Info className="size-4 shrink-0" />
                                        Next run in <strong className="font-semibold text-foreground">{formatCountdown(countdown)}</strong>
                                    </p>
                                )}
                            </div>

                            <div className="flex flex-col gap-4 rounded-lg border bg-card p-6">
                                <div className="flex flex-col gap-1">
                                    <h3 className="text-base font-semibold text-foreground">Timing</h3>
                                    <p className="text-sm text-muted-foreground">Set the frequency, day, time, and timezone for scheduled syncs.</p>
                                </div>
                                <div className="grid gap-4 sm:grid-cols-2">
                                    <div className="flex flex-col gap-1.5">
                                        <Label htmlFor="schedule-frequency" className="text-sm font-medium">Frequency</Label>
                                        <Select value={schedule.frequency} onValueChange={(value) => update('frequency', value)}>
                                            <SelectTrigger id="schedule-frequency" className="w-full" aria-label="Schedule frequency">
                                                <SelectValue placeholder="Frequency" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="daily">Daily</SelectItem>
                                                <SelectItem value="weekly">Weekly</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>

                                    {schedule.frequency === 'weekly' && (
                                        <div className="flex flex-col gap-1.5">
                                            <Label htmlFor="schedule-day" className="text-sm font-medium">Day</Label>
                                            <Select value={schedule.day_of_week} onValueChange={(value) => update('day_of_week', value)}>
                                                <SelectTrigger id="schedule-day" className="w-full" aria-label="Schedule day">
                                                    <SelectValue placeholder="Day" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {DAYS.map((d) => (
                                                        <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    )}

                                    <div className="flex flex-col gap-1.5">
                                        <Label htmlFor="schedule-time" className="text-sm font-medium">Time</Label>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            className="justify-start font-normal"
                                            id="schedule-time"
                                            aria-label="Choose schedule time"
                                            onClick={() => setShowClock(true)}
                                        >
                                            {String(schedule.hour).padStart(2, '0')}:{String(schedule.minute).padStart(2, '0')}
                                        </Button>
                                    </div>

                                    <div className="flex flex-col gap-1.5 sm:col-span-2">
                                        <Label htmlFor="schedule-timezone" className="text-sm font-medium">Timezone</Label>
                                        <Select value={String(schedule.timezone)} onValueChange={(value) => update('timezone', Number(value))}>
                                            <SelectTrigger id="schedule-timezone" className="w-full" aria-label="Schedule timezone">
                                                <SelectValue placeholder="Timezone" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {TIMEZONES.map((tz) => (
                                                    <SelectItem key={tz.value} value={String(tz.value)}>{tz.label}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
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

                                <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                                    <Info className="size-4 shrink-0" /> Runs in <strong className="font-semibold text-foreground">{timeUntilStr}</strong> <span className="text-xs text-muted-foreground">({tzLabel})</span>
                                </p>
                                <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                                    <Info className="size-4 shrink-0" /> Executes on the server at <strong className="font-semibold text-foreground">{serverExecutionLabel}</strong> <span className="text-xs text-muted-foreground">({formatUtcOffsetLabel(serverTimezoneOffset)} server time)</span>
                                </p>
                            </div>

                            <div className="flex flex-col gap-4 rounded-lg border bg-card p-6">
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                    <div className="flex flex-col gap-1">
                                        <h3 className="text-base font-semibold text-foreground">Sources</h3>
                                        <p className="text-sm text-muted-foreground">Choose which feeds the scheduler should include.</p>
                                    </div>
                                    <Badge variant="outline">{selectedSourceCount} selected</Badge>
                                </div>
                                <div className="grid gap-3 sm:grid-cols-2">
                                    {SOURCE_LIST.map((src) => (
                                        <div key={src.key} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
                                            <Label htmlFor={`schedule-source-${src.key}`} className="text-sm font-medium">{src.label}</Label>
                                            <Switch
                                                id={`schedule-source-${src.key}`}
                                                checked={schedule.sources?.[src.key] ?? true}
                                                onCheckedChange={(val) => updateSource(src.key, val)}
                                            />
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="flex flex-col gap-4 rounded-lg border bg-card p-6">
                                <div className="flex flex-col gap-1">
                                    <h3 className="text-base font-semibold text-foreground">Options</h3>
                                    <p className="text-sm text-muted-foreground">Set additional rules applied during scheduled runs.</p>
                                </div>
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
                                        <Label htmlFor="schedule-no-ai" className="text-sm font-medium">Skip AI Filter</Label>
                                        <Switch id="schedule-no-ai" checked={schedule.no_ai} onCheckedChange={(val) => update('no_ai', val)} />
                                    </div>
                                    <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
                                        <Label htmlFor="schedule-include-expired" className="text-sm font-medium">Include Expired</Label>
                                        <Switch id="schedule-include-expired" checked={schedule.include_expired} onCheckedChange={(val) => update('include_expired', val)} />
                                    </div>
                                </div>
                            </div>

                            {saveResult && (
                                <div className={`rounded-lg border p-4 text-sm ${saveResult.success ? 'border-green-600/30 bg-green-600/10' : 'border-destructive/30 bg-destructive/5'}`}>
                                    <span className={`font-semibold ${saveResult.success ? 'text-green-600' : 'text-destructive'}`}>
                                        {saveResult.success ? 'Saved:' : 'Warning:'} {saveResult.message}
                                    </span>
                                </div>
                            )}

                            <div className="flex flex-col gap-4 rounded-lg border bg-card p-6">
                                <div className="flex flex-col gap-1">
                                    <h3 className="text-base font-semibold text-foreground">Run History</h3>
                                    <p className="text-sm text-muted-foreground">Review previous runs, durations, and scraper output.</p>
                                </div>
                                {logs.length === 0 ? (
                                    <p className="text-sm text-muted-foreground">No scheduled runs yet.</p>
                                ) : (
                                    <div className="flex flex-col gap-3">
                                        {logs.map((log, i) => (
                                            <div key={i} className="flex flex-col overflow-hidden rounded-lg border">
                                                <div
                                                    className="flex flex-wrap cursor-pointer items-center gap-x-3 gap-y-1.5 px-4 py-3 hover:bg-muted/40"
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
                                                    <Badge className={log.success ? 'bg-green-600 text-primary-foreground' : 'bg-destructive text-primary-foreground'}>
                                                        {log.success ? 'OK' : 'Failed'}
                                                    </Badge>
                                                    <Badge variant="outline">
                                                        {log.trigger === 'scheduled' ? 'Auto' : 'Manual'}
                                                    </Badge>
                                                    <span className="text-xs text-muted-foreground">{formatDateTime(log.started_at)}</span>
                                                    <span className="text-xs text-muted-foreground">{formatDuration(log.started_at, log.finished_at)}</span>
                                                    <span className="text-xs font-medium text-foreground">{log.new_project_count ?? log.summary?.new_projects ?? 0} new</span>
                                                    <span className="ml-auto text-sm font-medium text-muted-foreground">{expandedLog === i ? '-' : '+'}</span>
                                                </div>
                                                {expandedLog === i && (
                                                    <div className="flex flex-col gap-3 border-t bg-muted/30 px-4 py-4">
                                                        <div className="flex flex-wrap gap-2">
                                                            <Button
                                                                type="button"
                                                                size="sm"
                                                                variant={scraperLogTab === 'summary' ? 'default' : 'outline'}
                                                                onClick={() => setScraperLogTab('summary')}
                                                            >
                                                                Summary
                                                            </Button>
                                                            {scraperLogData[i] && Object.entries(scraperLogData[i]).map(([key, s]) => (
                                                                <Button
                                                                    key={key}
                                                                    type="button"
                                                                    size="sm"
                                                                    variant={scraperLogTab === key ? 'default' : 'outline'}
                                                                    onClick={() => setScraperLogTab(key)}
                                                                >
                                                                    {s.label || key}
                                                                </Button>
                                                            ))}
                                                        </div>
                                                        <pre className="max-h-72 overflow-y-auto rounded-lg border bg-card p-4 font-mono text-xs leading-5 text-foreground">
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
            </ScrollArea>

            <div className="flex items-center justify-between gap-3 border-t p-4">
                <div className="flex flex-col">
                    <strong className="text-sm text-foreground">{schedule.enabled ? 'Schedule enabled' : 'Schedule disabled'}</strong>
                    <span className="text-xs text-muted-foreground">
                        {schedule.enabled && nextRun
                            ? `Next run ${formatDateTime(nextRun)}`
                            : `${selectedSourceCount} source${selectedSourceCount === 1 ? '' : 's'} configured`}
                    </span>
                </div>
                <div className="flex items-center gap-3">
                    <Button type="button" variant="ghost" onClick={onBack}>Back</Button>
                    <Button type="button" onClick={handleSave} disabled={saving || !!loadError}>
                        {saving && <LoaderCircle className="size-4 animate-spin" />}
                        Save Schedule
                    </Button>
                </div>
            </div>
        </div>
    );
}
