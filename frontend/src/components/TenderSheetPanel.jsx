import { Button as ShadcnButton } from '@/components/ui/button';
import { Input as ShadcnInput } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Search, ThumbsUp, ThumbsDown } from 'lucide-react';

function initials(name = '', email = '') {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    if (parts.length === 1) return parts[0][0].toUpperCase();
    return (email[0] || '?').toUpperCase();
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

export default function TenderSheetPanel({
    project,
    availableUsers,
    comments,
    canEditDeadline,
    savingDeadline,
    deadlineInput,
    setDeadlineInput,
    onDeadlineSave,
    onVoteChange,
    onToggleAssignment,
    discussionSearch,
    setDiscussionSearch,
    discussionSearchOpen,
    setDiscussionSearchOpen,
}) {
    if (!project) return null;

    return (
        <div className="border-b p-4 space-y-4 overflow-y-auto max-h-[40vh]">
            <div className="flex items-center justify-between gap-2">
                <div className="flex items-baseline gap-2">
                    <h3 className="text-sm font-semibold">Discussion</h3>
                    <span className="text-xs text-muted-foreground">{(comments || []).length} notes</span>
                </div>
                <ShadcnButton
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className={`transition-colors duration-200 ${discussionSearchOpen ? 'bg-muted text-foreground' : 'text-muted-foreground'}`}
                    aria-label={discussionSearchOpen ? 'Hide message search' : 'Search messages'}
                    onClick={() => {
                        if (discussionSearchOpen && !discussionSearch) {
                            setDiscussionSearchOpen(false);
                            return;
                        }
                        setDiscussionSearchOpen((prev) => !prev);
                    }}
                >
                    <Search className="size-4" />
                </ShadcnButton>
            </div>
            {discussionSearchOpen ? (
                <div className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <ShadcnInput
                        type="text"
                        name="discussionSearch"
                        aria-label="Search discussion messages"
                        placeholder="Search messages..."
                        value={discussionSearch}
                        onChange={(e) => setDiscussionSearch(e.target.value)}
                        className="h-9 pl-8"
                    />
                </div>
            ) : null}

            <Separator />

            <div className="flex flex-col gap-2">
                <div>
                    <h3 className="text-sm font-semibold">Team signal</h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">Upvote or downvote the tender without changing the formal decision.</p>
                </div>
                <div className="flex gap-2">
                    <ShadcnButton
                        type="button"
                        variant="outline"
                        size="sm"
                        className={`gap-1.5 transition-colors duration-200 ${(project?.current_user_vote || '') === 'up' ? 'border-success/30 bg-success/10 text-success hover:bg-success/10 hover:text-success' : ''}`}
                        onClick={() => onVoteChange(project.db_id, (project?.current_user_vote || '') === 'up' ? '' : 'up')}
                    >
                        <ThumbsUp className="size-4" />
                        <span>Upvote</span>
                        <strong>{project?.vote_summary?.up || 0}</strong>
                    </ShadcnButton>
                    <ShadcnButton
                        type="button"
                        variant="outline"
                        size="sm"
                        className={`gap-1.5 transition-colors duration-200 ${(project?.current_user_vote || '') === 'down' ? 'border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/10 hover:text-destructive' : ''}`}
                        onClick={() => onVoteChange(project.db_id, (project?.current_user_vote || '') === 'down' ? '' : 'down')}
                    >
                        <ThumbsDown className="size-4" />
                        <span>Downvote</span>
                        <strong>{project?.vote_summary?.down || 0}</strong>
                    </ShadcnButton>
                </div>
            </div>

            <div className="flex flex-col gap-2">
                <div>
                    <h3 className="text-sm font-semibold">Working on this tender</h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">Assign teammates to coordinate review and follow-up.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                    {(availableUsers || []).map((user) => {
                        const assigned = (project?.assigned_user_ids || []).includes(user.id);
                        return (
                            <button
                                key={user.id}
                                type="button"
                                onClick={() => onToggleAssignment(user.id)}
                                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors duration-200 ${assigned ? 'border-primary/30 bg-primary/5 text-primary' : 'border-border bg-card text-muted-foreground hover:bg-muted'}`}
                            >
                                <span className="flex size-5 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">{initials(user.name || '', user.email || '')}</span>
                                <span>{user.name || user.email}</span>
                            </button>
                        );
                    })}
                </div>
            </div>

            <div className="flex flex-col gap-2">
                <div>
                    <h3 className="text-sm font-semibold">Manual deadline</h3>
                    <p className="text-xs text-muted-foreground">{canEditDeadline ? 'Override the scraped deadline when analyst review requires a correction.' : 'Only admins and managers can edit the deadline.'}</p>
                </div>
                <div className="flex items-end gap-2">
                    <ShadcnInput
                        type="date"
                        name="manualDeadline"
                        aria-label="Manual deadline"
                        value={deadlineInput}
                        onChange={(e) => setDeadlineInput(e.target.value)}
                        disabled={!canEditDeadline || savingDeadline}
                        className="w-auto"
                    />
                    <ShadcnButton
                        type="button"
                        size="sm"
                        onClick={onDeadlineSave}
                        disabled={!canEditDeadline || savingDeadline}
                    >
                        {savingDeadline ? 'Saving...' : 'Save deadline'}
                    </ShadcnButton>
                </div>
                {project?.deadline_updated_by || project?.deadline_updated_at ? (
                    <p className="text-xs text-muted-foreground">
                        {project?.deadline_updated_by ? `Updated by ${project.deadline_updated_by}` : 'Deadline updated'}
                        {project?.deadline_updated_at ? ` on ${formatDisplayDate(project.deadline_updated_at)}` : ''}
                    </p>
                ) : null}
            </div>
        </div>
    );
}
