import { useEffect, useState, useCallback } from 'react';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import ProjectInspector from '../components/ProjectInspector';
import TenderDetailSkeleton from '../components/TenderDetailSkeleton';

const API = '/api';

export default function TenderDetailPage({ dbId, apiFetch, authUser, availableUsers }) {
    const [project, setProject] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [comments, setComments] = useState([]);
    const [commentsLoading, setCommentsLoading] = useState(false);

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
            const res = await apiFetch(`${API}/comments?entityType=project&entityId=${encodeURIComponent(dbId)}&mine=false`);
            if (!res.ok) throw new Error(`Failed to load comments (${res.status})`);
            const data = await res.json();
            setComments(Array.isArray(data?.comments) ? data.comments : []);
        } catch (err) {
            setComments([]);
        } finally {
            setCommentsLoading(false);
        }
    }, [dbId, apiFetch]);

    useEffect(() => {
        loadProject();
        loadComments();
    }, [loadProject, loadComments]);

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

    const goBack = () => {
        window.location.hash = '#dashboard';
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
            <div className="flex items-center gap-3 border-b px-6 py-4">
                <Button variant="ghost" size="sm" onClick={goBack}>
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Back
                </Button>
                <span className="text-sm text-muted-foreground">Tender detail</span>
            </div>
            <ProjectInspector
                project={project}
                comments={comments}
                commentsLoading={commentsLoading}
                authUser={authUser}
                availableUsers={availableUsers}
                canManageDecision={authUser?.role !== 'viewer'}
                onDecisionChange={handleDecisionChange}
                onOpenFullPage={null}
                onRunSmartZiw={handleRunSmartZiw}
                compact={false}
            />
        </div>
    );
}
