import { useMemo } from 'react';
import { CalendarClock } from 'lucide-react';
import { formatDisplayDate } from '@/utils/tenderDisplay';

const RADAR_WINDOW_DAYS = 30;
const URGENT_DAYS = 7;
const MAX_ROWS = 6;

function deadlineOf(project) {
    const raw = project.effective_deadline || project.manual_deadline || project.scraped_deadline || project.project_end_date || '';
    if (!raw) return null;
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? null : date;
}

function chipClasses(daysLeft, analyzed) {
    if (daysLeft <= URGENT_DAYS && !analyzed) {
        return 'border-destructive/40 bg-destructive/10 text-destructive';
    }
    if (daysLeft <= URGENT_DAYS) {
        return 'border-amber-500/40 bg-amber-500/10 text-amber-600';
    }
    return 'border-border bg-muted text-muted-foreground';
}

export default function DeadlineRadar({ projects, onOpenTender, onViewAll }) {
    const rows = useMemo(() => {
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        return (projects || [])
            .map((project) => {
                const date = deadlineOf(project);
                if (!date) return null;
                const daysLeft = Math.ceil((date - todayStart) / 86400000);
                if (daysLeft > RADAR_WINDOW_DAYS) return null;
                return { project, date, daysLeft };
            })
            .filter(Boolean)
            .sort((a, b) => a.date - b.date)
            .slice(0, MAX_ROWS);
    }, [projects]);

    const urgentCount = rows.filter(({ project, daysLeft }) => (
        daysLeft <= URGENT_DAYS && !project.smart_ziw_status
    )).length;

    if (!rows.length) return null;

    return (
        <section className="rounded-lg border bg-card">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
                <div className="flex items-center gap-2">
                    <CalendarClock className="h-4 w-4 text-muted-foreground" />
                    <h3 className="text-sm font-semibold text-foreground">Deadline radar</h3>
                    <span className="text-xs text-muted-foreground">next {RADAR_WINDOW_DAYS} days</span>
                </div>
                <div className="flex items-center gap-3">
                    {urgentCount ? (
                        <span className="text-xs font-medium text-destructive">
                            {urgentCount} unanalyzed ≤ {URGENT_DAYS}d
                        </span>
                    ) : null}
                    {onViewAll ? (
                        <button
                            type="button"
                            onClick={onViewAll}
                            className="text-xs font-medium text-primary transition-colors duration-200 hover:underline"
                        >
                            View all
                        </button>
                    ) : null}
                </div>
            </header>
            <div className="grid grid-cols-1 gap-2 p-3 lg:grid-cols-2">
                {rows.map(({ project, date, daysLeft }) => {
                    const analyzed = Boolean(project.smart_ziw_status);
                    const label = daysLeft < 0 ? 'Overdue' : daysLeft === 0 ? 'Today' : `${daysLeft}d`;
                    return (
                        <button
                            key={project.db_id || project.project_id}
                            type="button"
                            onClick={() => onOpenTender?.(project.db_id)}
                            className="flex min-w-0 items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors duration-200 hover:bg-muted/60"
                        >
                            <span className={`shrink-0 rounded-md border px-2 py-0.5 text-xs font-semibold ${chipClasses(daysLeft, analyzed)}`}>
                                {label}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                                {project.project_name || project.project_description || 'Untitled tender'}
                            </span>
                            <span className="shrink-0 text-xs text-muted-foreground">{formatDisplayDate(date)}</span>
                            {project.decision ? (
                                <span className={`shrink-0 rounded-md border px-2 py-0.5 text-xs font-medium ${project.decision === 'Go' ? 'border-success/40 bg-success/10 text-success' : 'border-destructive/40 bg-destructive/10 text-destructive'}`}>
                                    {project.decision}
                                </span>
                            ) : null}
                        </button>
                    );
                })}
            </div>
        </section>
    );
}
