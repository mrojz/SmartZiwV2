import { useCallback, useEffect, useState } from 'react';
import { LoaderCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

function formatDateTime(value) {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const STATUS_STYLES = {
    ok: { dot: 'bg-emerald-500', text: 'text-emerald-600', label: 'Healthy' },
    error: { dot: 'bg-red-500', text: 'text-red-600', label: 'Failing' },
    never: { dot: 'bg-muted-foreground/30', text: 'text-muted-foreground', label: 'No runs yet' },
};

function recentDotClass(status) {
    if (status === 'ok') return 'bg-emerald-500';
    if (status === 'error') return 'bg-red-500';
    return 'bg-border';
}

export default function ScraperHealthPanel({ apiFetch }) {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const res = await apiFetch('/api/admin/scraper-health');
            if (!res.ok) throw new Error(`Request failed (${res.status})`);
            setData(await res.json());
        } catch (err) {
            setError(err.message || 'Failed to load scraper health');
        } finally {
            setLoading(false);
        }
    }, [apiFetch]);

    useEffect(() => { load(); }, [load]);

    if (loading && !data) {
        return <div className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" /> Loading scraper health…</div>;
    }

    if (error && !data) {
        return (
            <div className="flex flex-col gap-3">
                <p className="text-sm text-destructive">{error}</p>
                <div><Button type="button" variant="outline" size="sm" onClick={load}><RefreshCw className="size-4" /> Retry</Button></div>
            </div>
        );
    }

    const scrapers = data?.scrapers || [];
    const failing = scrapers.filter((s) => s.status === 'error').length;
    const lastSync = data?.last_sync;

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    {lastSync ? (
                        <>
                            <span>
                                Last sync: <strong className="text-foreground">{formatDateTime(lastSync.started_at)}</strong>
                                {lastSync.trigger ? ` · ${lastSync.trigger}` : ''}
                            </span>
                            <Badge variant="outline" className={lastSync.success ? 'text-emerald-600 border-emerald-600/30' : 'text-red-600 border-red-600/30'}>
                                {lastSync.success ? 'succeeded' : 'failed'}
                            </Badge>
                        </>
                    ) : (
                        <span>No syncs recorded yet.</span>
                    )}
                    {data?.running ? (
                        <Badge variant="outline" className="text-primary border-primary/30"><LoaderCircle className="size-3 animate-spin" /> sync running</Badge>
                    ) : null}
                    {failing > 0 ? <Badge variant="outline" className="text-red-600 border-red-600/30">{failing} failing</Badge> : null}
                </div>
                <Button type="button" variant="outline" size="sm" onClick={load} disabled={loading}>
                    <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
                </Button>
            </div>

            <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                            <th className="px-3 py-2 font-medium">Scraper</th>
                            <th className="px-3 py-2 font-medium">Status</th>
                            <th className="px-3 py-2 font-medium">Last run</th>
                            <th className="px-3 py-2 font-medium">Tenders</th>
                            <th className="px-3 py-2 font-medium">Duration</th>
                            <th className="px-3 py-2 font-medium">Recent runs</th>
                            <th className="px-3 py-2 font-medium">Last error</th>
                        </tr>
                    </thead>
                    <tbody>
                        {scrapers.map((s) => {
                            const style = STATUS_STYLES[s.status] || STATUS_STYLES.never;
                            return (
                                <tr key={s.key} className="border-b last:border-0">
                                    <td className="px-3 py-2.5 font-medium text-foreground">{s.label}</td>
                                    <td className="px-3 py-2.5">
                                        <span className="inline-flex items-center gap-1.5">
                                            <span className={`size-2 rounded-full ${style.dot}`} />
                                            <span className={`text-xs font-medium ${style.text}`}>{style.label}</span>
                                            {s.consecutive_failures > 1 ? (
                                                <Badge variant="outline" className="text-red-600 border-red-600/30">×{s.consecutive_failures}</Badge>
                                            ) : null}
                                            {s.zero_runs >= 3 ? (
                                                <Badge variant="outline" className="text-amber-600 border-amber-600/30" title={`Returned 0 tenders in ${s.zero_runs} of the last runs without erroring`}>0 ×{s.zero_runs}</Badge>
                                            ) : null}
                                        </span>
                                    </td>
                                    <td className="px-3 py-2.5 text-xs text-muted-foreground">{s.last_run_at ? formatDateTime(s.last_run_at) : '—'}</td>
                                    <td className="px-3 py-2.5 text-xs text-muted-foreground">{s.status === 'never' ? '—' : s.last_count}</td>
                                    <td className="px-3 py-2.5 text-xs text-muted-foreground">{s.status === 'never' ? '—' : `${s.last_duration}s`}</td>
                                    <td className="px-3 py-2.5">
                                        <span className="inline-flex items-center gap-1">
                                            {(s.recent || []).map((r, i) => (
                                                <span
                                                    key={i}
                                                    title={`${r.status === 'miss' ? 'not in run' : r.status} · ${formatDateTime(r.at)}`}
                                                    className={`size-2 rounded-full ${recentDotClass(r.status)}`}
                                                />
                                            ))}
                                        </span>
                                    </td>
                                    <td className="max-w-[220px] truncate px-3 py-2.5 text-xs text-destructive" title={s.error || ''}>{s.error || '—'}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            <p className="text-xs text-muted-foreground">
                Recent runs show the last {data?.scrapers?.[0]?.recent?.length || 10} syncs, oldest to newest. A green dot means the scraper ran without error; grey means it was not part of that sync.
            </p>
        </div>
    );
}
