import { useEffect, useState, useCallback, useMemo } from 'react';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import ProjectInspector from '../components/ProjectInspector';
import TenderDetailSkeleton from '../components/TenderDetailSkeleton';
import TenderSheetPanel from '../components/TenderSheetPanel';
import CommentComposer from '../components/CommentComposer';
import { usePageHeader } from '../components/PageHeaderContext';

const API = '/api';

function toInputDate(value) {
    if (!value) return '';
    const direct = new Date(value);
    if (!Number.isNaN(direct.getTime())) {
        const day = String(direct.getDate()).padStart(2, '0');
        const month = String(direct.getMonth() + 1).padStart(2, '0');
        const year = direct.getFullYear();
        return `${year}-${month}-${day}`;
    }
    const parts = String(value).split('/');
    if (parts.length === 3) {
        const [month, day, year] = parts;
        return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
    return '';
}

export default function TenderDetailPage({ dbId, apiFetch, authUser, availableUsers, navigate }) {
    const [project, setProject] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [comments, setComments] = useState([]);
    const [commentsLoading, setCommentsLoading] = useState(false);
    const [commentsBody, setCommentsBody] = useState('');

    const [deadlineInput, setDeadlineInput] = useState('');
    const [savingDeadline, setSavingDeadline] = useState(false);
    const [discussionSearch, setDiscussionSearch] = useState('');
    const [discussionSearchOpen, setDiscussionSearchOpen] = useState(false);

    const canEditDeadline = authUser?.role === 'admin' || authUser?.role === 'manager';
    const canManageDecision = authUser?.role !== 'viewer';

    const { setPageHeader, clearPageHeader } = usePageHeader();

    useEffect(() => {
        setPageHeader({
            title: project?.project_name || 'Tender detail',
            subtitle: project ? `${project?.source || 'Unknown source'} · ${project?.country || 'Unknown location'}` : 'Loading tender...',
        });
        return () => clearPageHeader();
    }, [setPageHeader, clearPageHeader, project?.project_name, project?.source, project?.country]);

    const entity = useMemo(() => (
        project
            ? {
                type: 'project',
                id: project.project_id || project.project_name,
                label: project.project_name || project.project_description,
            }
            : null
    ), [project]);

    const loadProject = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await apiFetch(`${API}/projects/by-db-id/${encodeURIComponent(dbId)}`);
            if (!res.ok) throw new Error(res.status === 404 ? 'Tender not found' : `Failed to load tender (${res.status})`);
            const data = await res.json();
            if (!data || !data.db_id) throw new Error('Tender not found');
            setProject(data);
        } catch (err) {
            setError(err?.message || 'Unable to load tender');
        } finally {
            setLoading(false);
        }
    }, [dbId, apiFetch]);

    const loadComments = useCallback(async () => {
        if (!dbId) return;
        setCommentsLoading(true);
        try {
            const res = await apiFetch(`${API}/comments?entityType=project&entityId=${encodeURIComponent(entity?.id || dbId)}&mine=false`);
            if (!res.ok) throw new Error(`Failed to load comments (${res.status})`);
            const data = await res.json();
            setComments(Array.isArray(data?.comments) ? data.comments : []);
        } catch (err) {
            setComments([]);
        } finally {
            setCommentsLoading(false);
        }
    }, [dbId, entity?.id, apiFetch]);

    useEffect(() => {
        loadProject();
    }, [loadProject]);

    useEffect(() => {
        if (!project) return;
        loadComments();
    }, [project, loadComments]);

    useEffect(() => {
        setDeadlineInput(toInputDate(project?.manual_deadline || ''));
    }, [project?.manual_deadline]);

    const handleDecisionChange = async (decision) => {
        if (!project) return;
        try {
            const res = await apiFetch(`${API}/projects/${encodeURIComponent(project.db_id)}/decision`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ decision }),
            });
            if (!res.ok) throw new Error(`Failed to update decision (${res.status})`);
            loadProject();
        } catch (err) {
            toast.error(err?.message || 'Failed to update decision');
        }
    };

    const handleRunSmartZiw = async () => {
        if (!project) return;
        try {
            const res = await apiFetch(`${API}/projects/by-db-id/${encodeURIComponent(project.db_id)}/smart-ziw`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ force: false }),
            });
            if (!res.ok) throw new Error(`Failed to start Smart-Ziw (${res.status})`);
            loadProject();
        } catch (err) {
            toast.error(err?.message || 'Failed to start Smart-Ziw');
        }
    };

    const handleVoteChange = async (projectDbId, nextValue) => {
        if (!projectDbId || !project) return;
        const previousVote = project.current_user_vote || '';
        const previousSummary = project.vote_summary || { up: 0, down: 0 };
        const optimisticSummary = {
            up: Math.max(0, (previousSummary.up || 0) + (previousVote === 'up' ? -1 : 0) + (nextValue === 'up' ? 1 : 0)),
            down: Math.max(0, (previousSummary.down || 0) + (previousVote === 'down' ? -1 : 0) + (nextValue === 'down' ? 1 : 0)),
        };
        setProject((prev) => ({ ...prev, current_user_vote: nextValue, vote_summary: optimisticSummary }));
        try {
            const res = await apiFetch(`${API}/projects/by-db-id/${encodeURIComponent(projectDbId)}/vote`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ value: nextValue }),
            });
            if (!res.ok) throw new Error('Failed to update vote');
            const updated = await res.json();
            setProject((prev) => (prev?.db_id === updated.db_id ? { ...prev, ...updated } : prev));
        } catch (err) {
            setProject((prev) => ({ ...prev, current_user_vote: previousVote, vote_summary: previousSummary }));
            window.alert(err?.message || 'Failed to update vote');
        }
    };

    const handleAssignmentsChange = async (nextUserIds) => {
        if (!project?.db_id) return;
        const res = await apiFetch(`${API}/projects/by-db-id/${encodeURIComponent(project.db_id)}/assignments`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userIds: nextUserIds }),
        });
        if (!res.ok) throw new Error('Failed to update assignments');
        const updated = await res.json();
        setProject((prev) => (prev?.db_id === updated.db_id ? { ...prev, ...updated } : prev));
    };

    const toggleAssignment = async (userId) => {
        if (!project?.db_id) return;
        const assignedUserIds = project?.assigned_user_ids || [];
        const next = assignedUserIds.includes(userId)
            ? assignedUserIds.filter((item) => item !== userId)
            : [...assignedUserIds, userId];
        await handleAssignmentsChange(next);
    };

    const handleDeadlineSave = async () => {
        if (!canEditDeadline || !project?.db_id) return;
        setSavingDeadline(true);
        try {
            const res = await apiFetch(`${API}/projects/by-db-id/${encodeURIComponent(project.db_id)}/deadline`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ manualDeadline: deadlineInput || null }),
            });
            if (!res.ok) throw new Error('Failed to update deadline');
            const updated = await res.json();
            setProject((prev) => (prev?.db_id === updated.db_id ? { ...prev, ...updated } : prev));
        } catch (err) {
            toast.error(err?.message || 'Failed to update deadline');
        } finally {
            setSavingDeadline(false);
        }
    };

    const submitComment = async (pendingFiles = [], mentions = [], onFilesClear = null) => {
        if ((!commentsBody.trim() && !pendingFiles.length) || !entity?.id) return;
        const attachments = pendingFiles || [];
        const optimistic = {
            id: `tmp-${Date.now()}`,
            authorName: authUser?.name || 'You',
            body: commentsBody.trim(),
            attachments,
            mentions,
            createdAt: new Date().toISOString(),
        };
        setComments((prev) => [...prev, optimistic]);
        const text = commentsBody;
        setCommentsBody('');
        if (onFilesClear) onFilesClear();
        try {
            const res = await apiFetch('/api/comments', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entityType: entity.type,
                    entityId: entity.id,
                    projectDbId: project?.db_id || '',
                    body: text || ' ',
                    attachments,
                    mentions,
                }),
            });
            if (!res.ok) throw new Error('Failed to post comment');
            const created = await res.json().catch(() => null);
            if (created?.comment) {
                setComments((prev) => prev.map((item) => (item.id === optimistic.id ? created.comment : item)));
            }
            await loadComments();
        } catch (err) {
            toast.error(err?.message || 'Failed to post comment');
            setComments((prev) => prev.filter((item) => item.id !== optimistic.id));
        }
    };

    const goBack = () => {
        if (window.history.length > 1) {
            window.history.back();
        } else if (navigate) {
            navigate('dashboard');
        } else {
            window.location.hash = '#dashboard';
        }
    };

    if (loading) return <TenderDetailSkeleton />;

    if (error || !project) {
        return (
            <div className="flex flex-col items-center justify-center px-6 py-24 text-center">
                <h2 className="text-xl font-semibold text-foreground">{error || 'Tender not found'}</h2>
                <p className="mt-2 text-sm text-muted-foreground">This tender may have been removed or the link is incorrect.</p>
                <Button variant="outline" className="mt-6" onClick={goBack}>
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Back to tenders
                </Button>
            </div>
        );
    }

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="sticky top-0 z-10 flex items-center gap-3 border-b bg-background px-6 py-4">
                <Button variant="ghost" size="sm" onClick={goBack}>
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Back
                </Button>
                <span className="text-sm text-muted-foreground">Tender detail</span>
            </div>

            <TenderSheetPanel
                project={project}
                availableUsers={availableUsers}
                comments={comments}
                canEditDeadline={canEditDeadline}
                savingDeadline={savingDeadline}
                deadlineInput={deadlineInput}
                setDeadlineInput={setDeadlineInput}
                onDeadlineSave={handleDeadlineSave}
                onVoteChange={handleVoteChange}
                onToggleAssignment={toggleAssignment}
                discussionSearch={discussionSearch}
                setDiscussionSearch={setDiscussionSearch}
                discussionSearchOpen={discussionSearchOpen}
                setDiscussionSearchOpen={setDiscussionSearchOpen}
            />

            <ProjectInspector
                project={project}
                comments={comments}
                commentsLoading={commentsLoading}
                authUser={authUser}
                availableUsers={availableUsers}
                canManageDecision={canManageDecision}
                onDecisionChange={handleDecisionChange}
                onOpenFullPage={null}
                onRunSmartZiw={handleRunSmartZiw}
                compact={false}
            />

            <CommentComposer
                entity={entity}
                body={commentsBody}
                setBody={setCommentsBody}
                onSubmit={submitComment}
                currentUser={authUser}
                availableUsers={availableUsers}
                apiFetch={apiFetch}
                className="bg-background"
            />
        </div>
    );
}
