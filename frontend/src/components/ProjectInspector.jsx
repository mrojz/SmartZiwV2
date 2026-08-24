import { useMemo, useState } from 'react';
import TenderTabs from './TenderTabs';
import { Button as ShadcnButton } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Avatar as ShadcnAvatar, AvatarFallback } from '@/components/ui/avatar';
import { Sparkles } from 'lucide-react';
import {
    initials,
    isImageAttachment,
    isPdfAttachment,
    normalizeComment,
    colorFromSeed,
    formatDisplayDate,
    getUnifiedStatus,
} from '@/utils/tenderDisplay';
import CommentMarkdown from './CommentMarkdown';

export default function ProjectInspector({
    project,
    comments,
    commentsLoading,
    authUser,
    availableUsers,
    canManageDecision,
    onDecisionChange,
    onOpenFullPage,
    onRunSmartZiw,
    compact = false,
}) {
    const [activeTab, setActiveTab] = useState('activity');

    return (
        <div className="flex flex-col">
            <div className={`flex items-start justify-between gap-4 ${compact ? 'p-4 pb-2' : 'p-6 pb-4'}`}>
                <div>
                    <h2 className={`font-semibold text-foreground ${compact ? 'text-base' : 'text-xl'}`}>
                        {project.project_name || project.project_description || 'Untitled tender'}
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">{project.project_id || '-'}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                    <SmartZiwRunButton project={project} onRun={onRunSmartZiw} compact={compact} />
                    {onOpenFullPage ? (
                        <button
                            type="button"
                            onClick={onOpenFullPage}
                            className="text-sm font-medium text-primary transition-colors duration-200 hover:underline"
                        >
                            Open full page
                        </button>
                    ) : null}
                </div>
            </div>

            <TenderTabs activeTab={activeTab} onChange={setActiveTab} compact={compact} />

            <div className="min-h-0 flex-1">
                {activeTab === 'overview' && (
                    <div role="tabpanel" id="panel-overview" aria-labelledby="tab-overview">
                        <OverviewTab
                            project={project}
                            canManageDecision={canManageDecision}
                            onDecisionChange={onDecisionChange}
                            compact={compact}
                        />
                    </div>
                )}
                {activeTab === 'documents' && (
                    <div role="tabpanel" id="panel-documents" aria-labelledby="tab-documents">
                        <DocumentsTab project={project} compact={compact} />
                    </div>
                )}
                {activeTab === 'activity' && (
                    <div role="tabpanel" id="panel-activity" aria-labelledby="tab-activity">
                        <ActivityTab
                            comments={comments}
                            loading={commentsLoading}
                            authUser={authUser}
                            availableUsers={availableUsers}
                            compact={compact}
                        />
                    </div>
                )}
            </div>
        </div>
    );
}

function SmartZiwRunButton({ project, onRun, compact }) {
    const [running, setRunning] = useState(false);

    const handleClick = async () => {
        if (running || project?.smart_ziw_status === 'queued' || project?.smart_ziw_status === 'running') return;
        setRunning(true);
        try {
            await onRun?.();
        } catch (error) {
            window.alert(error?.message || 'Failed to start Smart-Ziw Agent');
        } finally {
            setRunning(false);
        }
    };

    const isBusy = running || project?.smart_ziw_status === 'queued' || project?.smart_ziw_status === 'running';
    const status = project?.smart_ziw_status;

    return (
        <div className="flex items-center gap-2">
            <ShadcnButton
                type="button"
                size={compact ? 'sm' : 'default'}
                onClick={handleClick}
                disabled={!project?.db_id || isBusy}
                className="gap-1.5"
            >
                <Sparkles className="h-4 w-4" />
                {isBusy ? 'Analysing…' : 'Run Smart-Ziw'}
            </ShadcnButton>
            {status ? (
                <Badge
                    variant={
                        status === 'error'
                            ? 'destructive'
                            : status === 'completed'
                                ? 'default'
                                : 'secondary'
                    }
                    className="text-[10px]"
                >
                    {status}
                </Badge>
            ) : null}
        </div>
    );
}



function OverviewTab({ project, canManageDecision, onDecisionChange, compact }) {
    const projectDecision = project?.decision || '';
    const projectRegion = project?.primary_region_name || project?.region || project?.region_name || '-';
    const effectiveDeadline = project?.effective_deadline || project?.manual_deadline || project?.scraped_deadline || project?.project_end_date || '';
    const projectDescription = project?.project_description && project.project_description !== project?.project_name
        ? project.project_description
        : '';
    const keywords = (project?.matched_keywords || '')
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean);
    const status = getUnifiedStatus(project);

    return (
        <div className={`flex flex-col gap-4 md:gap-6 ${compact ? 'p-4' : 'p-6'}`}>
            <section className="flex flex-col gap-4 rounded-lg border bg-card p-4">
                <div className="flex flex-wrap items-center gap-2">
                    <Badge className={status.classes}>{status.label}</Badge>
                    {status.source ? <Badge variant="outline">{status.source}</Badge> : null}
                    {project.smart_ziw_research_verdict ? (
                        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                            <span className={`h-1.5 w-1.5 rounded-full ${status.confidenceClasses}`} />
                            {status.confidence || 'unknown'} confidence
                        </span>
                    ) : null}
                    {project?.source ? <Badge variant="outline">{project.source}</Badge> : null}
                </div>

                {projectDescription ? (
                    <div className="flex flex-col gap-2 rounded-lg border bg-muted/50 p-4">
                        <h3 className="text-sm font-semibold text-foreground">Description</h3>
                        <p className="max-w-full overflow-x-auto whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{projectDescription}</p>
                    </div>
                ) : null}

                {canManageDecision ? (
                    <>
                        <Separator />
                        <div className="flex flex-col gap-3">
                            <div>
                                <h3 className="text-sm font-semibold text-foreground">Decision</h3>
                                <p className="mt-0.5 text-xs text-muted-foreground">Managers can set the formal Go / No Go decision.</p>
                            </div>
                            <div className="tender-decision-buttons grid grid-cols-3 gap-2">
                                <ShadcnButton
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className={`transition-colors duration-200 ${projectDecision === 'Go' ? 'border-success/30 bg-success/10 text-success hover:bg-success/10 hover:text-success' : ''}`}
                                    onClick={() => onDecisionChange(projectDecision === 'Go' ? '' : 'Go')}
                                >
                                    Go
                                </ShadcnButton>
                                <ShadcnButton
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className={`transition-colors duration-200 ${projectDecision === 'No Go' ? 'border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/10 hover:text-destructive' : ''}`}
                                    onClick={() => onDecisionChange(projectDecision === 'No Go' ? '' : 'No Go')}
                                >
                                    No Go
                                </ShadcnButton>
                                <ShadcnButton
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className={`transition-colors duration-200 ${!projectDecision ? 'border-foreground bg-muted/60 text-foreground hover:bg-muted/60 hover:text-foreground' : ''}`}
                                    onClick={() => onDecisionChange('')}
                                >
                                    Undecided
                                </ShadcnButton>
                            </div>
                        </div>
                    </>
                ) : null}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1 rounded-lg bg-muted p-3"><span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Project ID</span><strong className="text-sm font-medium text-foreground">{project?.project_id || '-'}</strong></div>
                    <div className="flex flex-col gap-1 rounded-lg bg-muted p-3"><span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Region</span><strong className="text-sm font-medium text-foreground">{projectRegion}</strong></div>
                    <div className="flex flex-col gap-1 rounded-lg bg-muted p-3"><span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Sponsor</span><strong className="text-sm font-medium text-foreground">{project?.project_sponsor || '-'}</strong></div>
                    <div className="flex flex-col gap-1 rounded-lg bg-muted p-3"><span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Start date</span><strong className="text-sm font-medium text-foreground">{formatDisplayDate(project?.project_start_date)}</strong></div>
                    <div className="flex flex-col gap-1 rounded-lg bg-muted p-3"><span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Deadline</span><strong className="text-sm font-medium text-foreground">{formatDisplayDate(effectiveDeadline)}</strong></div>
                    <div className="flex flex-col gap-1 rounded-lg bg-muted p-3">
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Source</span>
                        {project?.project_url ? (
                            <a
                                href={project.project_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="break-all text-sm font-medium text-primary transition-colors duration-200 hover:underline"
                            >
                                {project.source || project.project_url}
                            </a>
                        ) : (
                            <strong className="text-sm font-medium text-foreground">{project?.source || '-'}</strong>
                        )}
                    </div>
                    <div className="flex flex-col gap-1 rounded-lg bg-muted p-3"><span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Deadline source</span><strong className="text-sm font-medium text-foreground">{project?.deadline_source || '-'}</strong></div>
                    <div className="flex flex-col gap-1 rounded-lg bg-muted p-3"><span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Scraped deadline</span><strong className="text-sm font-medium text-foreground">{formatDisplayDate(project?.scraped_deadline || project?.project_end_date)}</strong></div>
                    <div className="flex flex-col gap-1 rounded-lg bg-muted p-3"><span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Manual deadline</span><strong className="text-sm font-medium text-foreground">{formatDisplayDate(project?.manual_deadline)}</strong></div>
                </div>

                {keywords.length > 0 ? (
                    <div className="flex flex-col gap-2">
                        <h3 className="text-sm font-semibold text-foreground">Signals</h3>
                        <div className="flex flex-wrap gap-1.5">
                            {keywords.map((kw) => (
                                <Badge key={kw} variant="secondary" className="font-medium">{kw}</Badge>
                            ))}
                        </div>
                    </div>
                ) : null}
            </section>

        </div>
    );
}

function DocumentsTab({ project, compact }) {
    return (
        <div className={`flex flex-col gap-3 ${compact ? 'p-4' : 'p-6'}`}>
            <section className="flex flex-col gap-3 rounded-lg border bg-card p-4">
                <h3 className="text-sm font-semibold text-foreground">Documents</h3>
                <div className="flex flex-col gap-2">
                    {project?.document_url ? (
                        <a
                            href={project.document_url}
                            target="_blank"
                            rel="noreferrer"
                            className="flex min-h-9 items-center rounded-lg bg-muted px-3 text-sm font-medium text-foreground transition-colors duration-200 hover:text-primary"
                        >
                            Open tender document
                        </a>
                    ) : (
                        <span className="flex min-h-9 items-center rounded-lg bg-muted px-3 text-sm text-muted-foreground">No tender document attached</span>
                    )}
                    {project?.project_url ? (
                        <a
                            href={project.project_url}
                            target="_blank"
                            rel="noreferrer"
                            className="flex min-h-9 items-center rounded-lg bg-muted px-3 text-sm font-medium text-foreground transition-colors duration-200 hover:text-primary"
                        >
                            Open source listing
                        </a>
                    ) : (
                        <span className="flex min-h-9 items-center rounded-lg bg-muted px-3 text-sm text-muted-foreground">No source link</span>
                    )}
                </div>
            </section>
        </div>
    );
}

function ActivityTab({ comments, loading, authUser, availableUsers, compact }) {
    const normalizedComments = useMemo(
        () => (Array.isArray(comments) ? comments.map(normalizeComment) : []),
        [comments],
    );
    const currentUserName = authUser?.name || '';

    return (
        <div className={`flex flex-col gap-3 ${compact ? 'p-4' : 'p-6'}`}>
            <section className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-2">
                    <div className="flex items-baseline gap-2">
                        <h3 className="text-sm font-semibold text-foreground">Discussion</h3>
                        <span className="text-xs text-muted-foreground">{normalizedComments.length} notes</span>
                    </div>
                </div>

                {loading ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">Loading discussion...</p>
                ) : (
                    <div className="flex flex-col gap-3 rounded-lg bg-muted/50 p-3">
                        {normalizedComments.length === 0 ? (
                            <p className="py-8 text-center text-sm text-muted-foreground">No discussion yet.</p>
                        ) : null}
                        {normalizedComments.map((c) => {
                            const isMe = c.authorName === currentUserName;
                            const ts = new Date(c.createdAt);
                            const timeStr = ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                            const dateStr = ts.toLocaleDateString([], { month: 'short', day: 'numeric' });
                            return (
                                <div key={c.id} className={`flex w-full gap-2 ${isMe ? 'flex-row-reverse' : ''}`}>
                                    <ShadcnAvatar className="mt-0.5 size-7 shrink-0" style={{ background: colorFromSeed(c.authorName || '') }}>
                                        <AvatarFallback className="bg-transparent text-[10px] font-bold uppercase tracking-wide text-white">
                                            {initials(c.authorName || '', '')}
                                        </AvatarFallback>
                                    </ShadcnAvatar>
                                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                                        <span className={`px-1 text-[11px] font-semibold text-muted-foreground ${isMe ? 'self-end' : ''}`}>{isMe ? 'You' : c.authorName}</span>
                                        <div className={`w-full break-words rounded-2xl px-3 py-2 text-sm leading-relaxed ${isMe ? 'rounded-tr-sm bg-primary text-primary-foreground' : 'rounded-tl-sm bg-muted text-foreground'}`}>
                                            {c.body ? <CommentMarkdown body={c.body} /> : null}
                                            {(c.attachments || []).map((att) => (
                                                isImageAttachment(att) ? (
                                                    <a
                                                        key={att.fileId}
                                                        href={att.url}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        className="mt-1.5 block w-full overflow-hidden rounded-lg border border-black/10"
                                                    >
                                                        <img
                                                            className="max-h-64 w-full object-cover"
                                                            src={att.url}
                                                            alt={att.originalName || 'attachment'}
                                                            loading="lazy"
                                                        />
                                                    </a>
                                                ) : isPdfAttachment(att) ? (
                                                    <a
                                                        key={att.fileId}
                                                        href={att.url}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        className="mt-1.5 flex w-full items-center gap-2 rounded-lg border border-black/10 bg-card px-3 py-2 text-left"
                                                    >
                                                        <Badge className="bg-destructive text-destructive-foreground">PDF</Badge>
                                                        <span className="min-w-0 truncate text-sm font-medium text-foreground">{att.originalName}</span>
                                                    </a>
                                                ) : (
                                                    <a
                                                        key={att.fileId}
                                                        className="mt-1.5 flex w-full items-center gap-2 rounded-lg border border-black/10 bg-card px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
                                                        href={att.url}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        download={att.originalName}
                                                    >
                                                        {att.originalName}
                                                    </a>
                                                )
                                            ))}
                                        </div>
                                        <span className={`px-1 text-[10px] text-muted-foreground/70 ${isMe ? 'self-end' : ''}`}>{dateStr}{" "}{timeStr}</span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </section>
        </div>
    );
}

