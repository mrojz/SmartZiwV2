import { useMemo, useState } from 'react';
import TenderTabs from './TenderTabs';
import { Button as ShadcnButton } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Avatar as ShadcnAvatar, AvatarFallback } from '@/components/ui/avatar';

function initials(name = '', email = '') {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    if (parts.length === 1) return parts[0][0].toUpperCase();
    return (email[0] || '?').toUpperCase();
}

function isImageAttachment(att = {}) {
    const mime = String(att?.mimeType || '').toLowerCase();
    if (mime.startsWith('image/')) return true;
    const name = String(att?.originalName || att?.url || '').toLowerCase();
    return /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(name);
}

function isPdfAttachment(att = {}) {
    const mime = String(att?.mimeType || '').toLowerCase();
    if (mime === 'application/pdf') return true;
    const name = String(att?.originalName || att?.url || '').toLowerCase();
    return /\.pdf($|\?)/i.test(name);
}

function normalizeCommentAttachment(raw) {
    if (!raw) return null;

    if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (!trimmed) return null;
        const normalizedUrl = trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('/')
            ? trimmed
            : `/${trimmed.replace(/^\.?\//, '')}`;
        const fileName = normalizedUrl.split('/').filter(Boolean).pop() || 'attachment';
        const lowerName = fileName.toLowerCase();
        const mimeType = /\.pdf($|\?)/i.test(lowerName)
            ? 'application/pdf'
            : (/\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(lowerName) ? `image/${lowerName.split('.').pop().replace('jpg', 'jpeg')}` : '');
        return {
            fileId: normalizedUrl,
            originalName: decodeURIComponent(fileName),
            mimeType,
            url: normalizedUrl,
        };
    }

    const source = raw && typeof raw === 'object' ? raw : {};
    const rawUrl = source.url || source.fileUrl || source.path || source.href || source.link || source.downloadUrl || '';
    const normalizedUrl = rawUrl
        ? (String(rawUrl).startsWith('http://') || String(rawUrl).startsWith('https://') || String(rawUrl).startsWith('/')
            ? String(rawUrl)
            : `/${String(rawUrl).replace(/^\.?\//, '')}`)
        : '';
    const originalName = source.originalName || source.filename || source.fileName || source.name || (normalizedUrl.split('/').filter(Boolean).pop() || 'attachment');
    const mimeType = source.mimeType || source.contentType || source.type || source.fileType || '';

    if (!normalizedUrl && !originalName) return null;

    return {
        ...source,
        fileId: source.fileId || source.id || normalizedUrl || originalName,
        originalName: String(originalName || 'attachment'),
        mimeType: String(mimeType || ''),
        url: normalizedUrl,
    };
}

function normalizeComment(comment = {}) {
    return {
        ...comment,
        attachments: (Array.isArray(comment.attachments) ? comment.attachments : [])
            .map(normalizeCommentAttachment)
            .filter(Boolean),
    };
}

function colorFromSeed(seed = '') {
    let hash = 0;
    for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) % 360;
    return `hsl(${hash} 45% 46%)`;
}

function formatDisplayDate(value) {
    if (!value) return '-';
    const direct = new Date(value);
    if (!Number.isNaN(direct.getTime())) {
        const day = String(direct.getDate()).padStart(2, '0');
        const month = String(direct.getMonth() + 1).padStart(2, '0');
        const year = direct.getFullYear();
        return `${day}/${month}/${year}`;
    }
    const parts = String(value).split('/');
    if (parts.length === 3) {
        const [month, day, year] = parts;
        return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
    }
    return value;
}

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
    const [activeTab, setActiveTab] = useState('overview');

    return (
        <div className="flex h-full flex-col">
            <div className={`flex items-start justify-between gap-4 ${compact ? 'p-4 pb-2' : 'p-6 pb-4'}`}>
                <div>
                    <h2 className={`font-semibold text-foreground ${compact ? 'text-base' : 'text-xl'}`}>
                        {project.project_name || project.project_description || 'Untitled tender'}
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">{project.project_id || '-'}</p>
                </div>
                <button
                    type="button"
                    onClick={onOpenFullPage}
                    className="text-sm font-medium text-primary hover:underline"
                >
                    Open full page
                </button>
            </div>

            <TenderTabs activeTab={activeTab} onChange={setActiveTab} compact={compact} />

            <div className="min-h-0 flex-1 overflow-auto">
                {activeTab === 'overview' && (
                    <OverviewTab
                        project={project}
                        canManageDecision={canManageDecision}
                        onDecisionChange={onDecisionChange}
                        compact={compact}
                    />
                )}
                {activeTab === 'documents' && <DocumentsTab project={project} compact={compact} />}
                {activeTab === 'activity' && (
                    <ActivityTab
                        comments={comments}
                        loading={commentsLoading}
                        authUser={authUser}
                        availableUsers={availableUsers}
                        compact={compact}
                    />
                )}
                {activeTab === 'smart-ziw' && <SmartZiwTab project={project} onRun={onRunSmartZiw} compact={compact} />}
            </div>
        </div>
    );
}

function OverviewTab({ project, canManageDecision, onDecisionChange, compact }) {
    const projectDecision = project?.decision || '';
    const projectVerified = project?.ai_verified === 'Yes';
    const projectRegion = project?.primary_region_name || project?.region || project?.region_name || '-';
    const effectiveDeadline = project?.effective_deadline || project?.manual_deadline || project?.scraped_deadline || project?.project_end_date || '';
    const projectDescription = project?.project_description && project.project_description !== project?.project_name
        ? project.project_description
        : '';
    const keywords = (project?.matched_keywords || '')
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean);

    return (
        <div className={`flex flex-col gap-4 ${compact ? 'p-4' : 'p-6'}`}>
            <section className="flex flex-col gap-4 rounded-lg border bg-card p-4">
                <div className="flex flex-wrap items-center gap-2">
                    <Badge className={projectDecision === 'Go' ? 'bg-green-600 text-primary-foreground hover:bg-green-600/90' : projectDecision === 'No Go' ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : 'bg-muted text-muted-foreground'}>
                        {projectDecision || 'Pending'}
                    </Badge>
                    <Badge className={projectVerified ? 'bg-green-600 text-primary-foreground hover:bg-green-600/90' : 'bg-muted text-muted-foreground'}>
                        {projectVerified ? 'Verified' : 'Not verified'}
                    </Badge>
                    {project?.source ? <Badge variant="outline">{project.source}</Badge> : null}
                </div>

                {projectDescription ? (
                    <div className="flex flex-col gap-2 rounded-lg border bg-muted/50 p-4">
                        <h3 className="text-sm font-semibold text-foreground">Description</h3>
                        <p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{projectDescription}</p>
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
                            <div className="grid grid-cols-3 gap-2">
                                <ShadcnButton
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className={projectDecision === 'Go' ? 'border-green-600/30 bg-green-600/10 text-green-600 hover:bg-green-600/10 hover:text-green-600' : ''}
                                    onClick={() => onDecisionChange(projectDecision === 'Go' ? '' : 'Go')}
                                >
                                    Go
                                </ShadcnButton>
                                <ShadcnButton
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className={projectDecision === 'No Go' ? 'border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/10 hover:text-destructive' : ''}
                                    onClick={() => onDecisionChange(projectDecision === 'No Go' ? '' : 'No Go')}
                                >
                                    No Go
                                </ShadcnButton>
                                <ShadcnButton
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className={!projectDecision ? 'border-foreground bg-muted/60 text-foreground hover:bg-muted/60 hover:text-foreground' : ''}
                                    onClick={() => onDecisionChange('')}
                                >
                                    Undecided
                                </ShadcnButton>
                            </div>
                        </div>
                    </>
                ) : null}

                <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1 rounded-lg bg-muted p-3"><span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Project ID</span><strong className="text-sm font-medium text-foreground">{project?.project_id || '-'}</strong></div>
                    <div className="flex flex-col gap-1 rounded-lg bg-muted p-3"><span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Region</span><strong className="text-sm font-medium text-foreground">{projectRegion}</strong></div>
                    <div className="flex flex-col gap-1 rounded-lg bg-muted p-3"><span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Sponsor</span><strong className="text-sm font-medium text-foreground">{project?.project_sponsor || '-'}</strong></div>
                    <div className="flex flex-col gap-1 rounded-lg bg-muted p-3"><span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Start date</span><strong className="text-sm font-medium text-foreground">{formatDisplayDate(project?.project_start_date)}</strong></div>
                    <div className="flex flex-col gap-1 rounded-lg bg-muted p-3"><span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Deadline</span><strong className="text-sm font-medium text-foreground">{formatDisplayDate(effectiveDeadline)}</strong></div>
                    <div className="flex flex-col gap-1 rounded-lg bg-muted p-3"><span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Source</span><strong className="text-sm font-medium text-foreground">{project?.source || '-'}</strong></div>
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
                            className="flex min-h-9 items-center rounded-lg bg-muted px-3 text-sm font-medium text-foreground hover:text-primary"
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
                            className="flex min-h-9 items-center rounded-lg bg-muted px-3 text-sm font-medium text-foreground hover:text-primary"
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
                                <div key={c.id} className={`flex max-w-[85%] gap-2 ${isMe ? 'self-end flex-row-reverse' : 'self-start'}`}>
                                    {!isMe ? (
                                        <ShadcnAvatar className="mt-0.5 size-7 shrink-0" style={{ background: colorFromSeed(c.authorName || '') }}>
                                            <AvatarFallback className="bg-transparent text-[10px] font-bold uppercase tracking-wide text-white">
                                                {initials(c.authorName || '', '')}
                                            </AvatarFallback>
                                        </ShadcnAvatar>
                                    ) : null}
                                    <div className="flex min-w-0 flex-col gap-0.5">
                                        {!isMe ? <span className="px-1 text-[11px] font-semibold text-muted-foreground">{c.authorName}</span> : null}
                                        <div className={`break-words rounded-2xl px-3 py-2 text-sm leading-relaxed ${isMe ? 'rounded-tr-sm bg-primary text-primary-foreground' : 'rounded-tl-sm bg-muted text-foreground'}`}>
                                            {c.body ? <p className="m-0">{c.body}</p> : null}
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

function SmartZiwTab({ project, onRun, compact }) {
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

    return (
        <div className={`flex flex-col gap-3 ${compact ? 'p-4' : 'p-6'}`}>
            <Card>
                <CardHeader className="px-4 pb-2 pt-4">
                    <CardTitle className="text-sm font-semibold">Smart-Ziw Agent</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col items-start gap-2.5 px-4 pb-4">
                    <div className="project-inspector-actions mt-3 flex flex-col items-start gap-2.5">
                        <ShadcnButton
                            type="button"
                            onClick={handleClick}
                            disabled={!project?.db_id || isBusy}
                        >
                            {isBusy ? 'Generating...' : 'Smart-Ziw Agent'}
                        </ShadcnButton>
                        {project?.smart_ziw_status ? (
                            <span className={`text-xs ${project?.smart_ziw_status === 'error' ? 'text-destructive' : project.smart_ziw_status === 'completed' ? 'text-green-600' : project.smart_ziw_status === 'queued' || project.smart_ziw_status === 'running' ? 'text-primary' : 'text-muted-foreground'}`}>
                                {project?.smart_ziw_status === 'error' && project?.smart_ziw_error
                                    ? `Last run failed: ${project.smart_ziw_error}`
                                    : `Smart-Ziw status: ${project.smart_ziw_status}`}
                            </span>
                        ) : null}
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
