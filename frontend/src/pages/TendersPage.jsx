import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { usePageHeader } from '../components/PageHeaderContext';
import ProjectTable from '../components/ProjectTable';
import ProjectInspector from '../components/ProjectInspector';
import DeadlineRadar from '../components/DeadlineRadar';
import SectionCard from '../components/SectionCard';
import CommentComposer from '../components/CommentComposer';
import TenderSheetPanel from '../components/TenderSheetPanel';
import { Button as ShadcnButton } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
    Sheet,
    SheetClose,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from '@/components/ui/sheet';
import { X } from 'lucide-react';
import {
    getTenderIdFromHash,
    buildSheetHash,
    buildFullPageHash,
    buildTenderShareUrl,
    isTenderSheetHash,
    isTenderFullPageHash,
} from '../utils/tenderRouting';
import { filterProjects, parseFilterDate } from '../utils/savedSearchMatch';

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

export default function TendersPage({
    apiFetch,
    authUser,
    availableUsers,
    regions,
    continents,
    sources,
    dashboardStats,
    projects,
    setProjects,
    projectsLoading,
    projectsError,
    loadProjects,
    newProjectIds,
    onStartDemo,
}) {
    const { setPageHeader, clearPageHeader } = usePageHeader();

    useEffect(() => {
        setPageHeader({
            title: 'Procurement Watch',
            subtitle: 'Track tenders, review sources, and manage decisions.',
        });
        return () => clearPageHeader();
    }, [setPageHeader, clearPageHeader]);

    // Filter / chip state
    const [chips, setChips] = useState([]);
    const [freeText, setFreeText] = useState('');
    const [source, setSource] = useState('');
    const [verified, setVerified] = useState('Yes');
    const [region, setRegion] = useState('');
    const [continent, setContinent] = useState('');
    const [decision, setDecision] = useState('');
    const [startDateFrom, setStartDateFrom] = useState('');
    const [startDateTo, setStartDateTo] = useState('');
    const [endDateFrom, setEndDateFrom] = useState('');
    const [endDateTo, setEndDateTo] = useState('');
    const [scrapedFrom, setScrapedFrom] = useState('');
    const [scrapedTo, setScrapedTo] = useState('');
    const [expiringSoonOnly, setExpiringSoonOnly] = useState(false);
    const [expiringSoonDays, setExpiringSoonDays] = useState(5);

    // Saved searches are local to the tender page so they can be applied directly to filter state.
    const [savedSearches, setSavedSearches] = useState([]);

    // Project inspector / comments state
    const [commentsOpen, setCommentsOpen] = useState(false);
    const [selectedProject, setSelectedProject] = useState(null);
    const [selectedProjectIndex, setSelectedProjectIndex] = useState(null);
    // Hash as state so direct navigation to a sheet hash re-runs the sheet-open effect.
    const [sheetHash, setSheetHash] = useState(window.location.hash);

    useEffect(() => {
        const onHash = () => setSheetHash(window.location.hash);
        window.addEventListener('hashchange', onHash);
        return () => window.removeEventListener('hashchange', onHash);
    }, []);
    const [commentsMine, setCommentsMine] = useState(false);
    const [commentsBody, setCommentsBody] = useState('');
    const [comments, setComments] = useState([]);
    const [commentsLoading, setCommentsLoading] = useState(false);
    const [shareCopied, setShareCopied] = useState(false);
    const [discussionSearch, setDiscussionSearch] = useState('');
    const [discussionSearchOpen, setDiscussionSearchOpen] = useState(false);
    const [deadlineInput, setDeadlineInput] = useState('');
    const [savingDeadline, setSavingDeadline] = useState(false);
    const [previewAttachment, setPreviewAttachment] = useState(null);

    // Load saved searches when the user is known.
    useEffect(() => {
        if (!authUser || authUser.mustChangePassword) return;
        apiFetch('/api/saved-searches')
            .then((r) => (r.ok ? r.json() : { searches: [] }))
            .then((data) => setSavedSearches(Array.isArray(data?.searches) ? data.searches : []))
            .catch(() => {});
    }, [authUser, apiFetch]);

    // Filters live in component state only. Syncing them into the URL hash is not
    // possible because the App router (normalizeRoute) treats '#dashboard?...' as an
    // unknown route and renders a blank page.

    const getRegion = useCallback((sponsor) => {
        if (!sponsor) return '';
        const lower = sponsor.toLowerCase();
        for (const [regionName, countries] of Object.entries(regions || {})) {
            if (countries.some((c) => lower.includes(c.toLowerCase()))) return regionName;
        }
        return '';
    }, [regions]);

    const filtered = useMemo(() => filterProjects(projects, {
        chips,
        freeText,
        source,
        verified,
        region,
        continent,
        decision,
        endDateFrom,
        endDateTo,
        scrapedFrom,
        scrapedTo,
        expiringSoonOnly,
        expiringSoonDays,
    }, regions), [projects, chips, freeText, source, verified, region, continent, regions, decision, endDateFrom, endDateTo, scrapedFrom, scrapedTo, expiringSoonOnly, expiringSoonDays]);

    // Watchlist: how many tenders matching each saved search arrived since it was last seen.
    const savedSearchNewCounts = useMemo(() => {
        const counts = {};
        for (const search of savedSearches) {
            const baseline = search.lastSeenAt || search.updatedAt || search.createdAt;
            if (!baseline) continue;
            const since = new Date(baseline);
            if (Number.isNaN(since.getTime())) continue;
            counts[search.id] = filterProjects(projects, search.filters || {}, regions).filter((p) => {
                const scrapedAt = parseFilterDate(p.scraped_at);
                return scrapedAt && scrapedAt > since;
            }).length;
        }
        return counts;
    }, [savedSearches, projects, regions]);

    const clearFilters = () => {
        setChips([]);
        setFreeText('');
        setSource('');
        setVerified('Yes');
        setRegion('');
        setContinent('');
        setDecision('');
        setStartDateFrom('');
        setStartDateTo('');
        setEndDateFrom('');
        setEndDateTo('');
        setScrapedFrom('');
        setScrapedTo('');
        setExpiringSoonOnly(false);
        setExpiringSoonDays(5);
    };

    const buildCurrentFilterState = useCallback(() => ({
        chips,
        freeText,
        source,
        verified,
        region,
        continent,
        decision,
        startDateFrom,
        startDateTo,
        endDateFrom,
        endDateTo,
        scrapedFrom,
        scrapedTo,
        expiringSoonOnly,
        expiringSoonDays,
    }), [
        chips,
        freeText,
        source,
        verified,
        region,
        continent,
        decision,
        startDateFrom,
        startDateTo,
        endDateFrom,
        endDateTo,
        scrapedFrom,
        scrapedTo,
        expiringSoonOnly,
        expiringSoonDays,
    ]);

    const applySavedFilterState = useCallback((filters = {}) => {
        setChips(Array.isArray(filters.chips) ? filters.chips : []);
        setFreeText(filters.freeText || '');
        setSource(filters.source || '');
        setVerified(filters.verified ?? 'Yes');
        setRegion(filters.region || '');
        setContinent(filters.continent || '');
        setDecision(filters.decision || '');
        setStartDateFrom(filters.startDateFrom || '');
        setStartDateTo(filters.startDateTo || '');
        setEndDateFrom(filters.endDateFrom || '');
        setEndDateTo(filters.endDateTo || '');
        setScrapedFrom(filters.scrapedFrom || '');
        setScrapedTo(filters.scrapedTo || '');
        setExpiringSoonOnly(Boolean(filters.expiringSoonOnly));
        setExpiringSoonDays(Math.max(1, Math.min(365, Number(filters.expiringSoonDays) || 5)));
    }, []);

    const persistSavedSearches = useCallback(async (nextSearches) => {
        const res = await apiFetch('/api/saved-searches', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ searches: nextSearches }),
        });
        if (!res.ok) throw new Error('Failed to save searches');
        const data = await res.json();
        setSavedSearches(Array.isArray(data?.searches) ? data.searches : []);
    }, [apiFetch]);

    const handleSaveCurrentSearch = useCallback(async (nameArg) => {
        const name = (nameArg && nameArg.trim()) || window.prompt('Saved search name');
        if (!name || !name.trim()) return;
        const now = new Date().toISOString();
        const next = [
            {
                id: `search-${Date.now()}`,
                name: name.trim(),
                filters: buildCurrentFilterState(),
                createdAt: now,
                updatedAt: now,
                lastSeenAt: now,
            },
            ...savedSearches.filter((item) => item.name.trim().toLowerCase() !== name.trim().toLowerCase()),
        ];
        await persistSavedSearches(next);
    }, [buildCurrentFilterState, savedSearches, persistSavedSearches]);

    const handleApplySavedSearch = useCallback(async (searchId) => {
        const match = savedSearches.find((item) => item.id === searchId);
        if (!match) return;
        applySavedFilterState(match.filters || {});
        // Opening the search marks its current matches as seen.
        const seenAt = new Date().toISOString();
        setSavedSearches((prev) => prev.map((item) => (item.id === searchId ? { ...item, lastSeenAt: seenAt } : item)));
        try {
            await persistSavedSearches(savedSearches.map((item) => (item.id === searchId ? { ...item, lastSeenAt: seenAt } : item)));
        } catch {
            // Badge will recompute from the un-persisted state on next load — not critical.
        }
    }, [savedSearches, applySavedFilterState, persistSavedSearches]);

    const handleDeleteSavedSearch = useCallback(async (searchId) => {
        const next = savedSearches.filter((item) => item.id !== searchId);
        await persistSavedSearches(next);
    }, [savedSearches, persistSavedSearches]);

    const canManageDecision = authUser?.role === 'manager' || authUser?.role === 'admin';
    const canEditDeadline = authUser?.role === 'admin' || authUser?.role === 'manager';

    const handleDecisionChange = async (index, nextDecision) => {
        if (!canManageDecision) return;
        if (index === null || index === undefined) return;
        const project = projects[index];
        if (!project) return;
        const previousDecision = project.decision;
        setProjects((prev) => {
            const next = [...prev];
            next[index] = { ...next[index], decision: nextDecision };
            return next;
        });
        if (selectedProjectIndex === index) {
            setSelectedProject((prev) => (prev ? { ...prev, decision: nextDecision } : prev));
        }
        try {
            const res = await apiFetch(
                project?.db_id
                    ? `${API}/projects/by-db-id/${encodeURIComponent(project.db_id)}/decision`
                    : `${API}/projects/${index}/decision`,
                {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ decision: nextDecision }),
                }
            );
            if (!res.ok) {
                throw new Error('Failed to update project decision');
            }
        } catch (error) {
            setProjects((prev) => {
                const next = [...prev];
                next[index] = { ...next[index], decision: previousDecision };
                return next;
            });
            if (selectedProjectIndex === index) {
                setSelectedProject((prev) => (prev ? { ...prev, decision: previousDecision } : prev));
            }
            window.alert(error?.message || 'Failed to update project decision');
            throw error;
        }
    };

    const handleDeadlineChange = async (index, manualDeadline) => {
        if (!canEditDeadline) return;
        const project = projects[index];
        const res = await apiFetch(
            project?.db_id
                ? `${API}/projects/by-db-id/${encodeURIComponent(project.db_id)}/deadline`
                : `${API}/projects/${index}/deadline`,
            {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ manualDeadline }),
            }
        );
        if (!res.ok) throw new Error('Failed to update deadline');
        const updated = await res.json();
        setProjects((prev) => {
            const next = [...prev];
            next[index] = { ...updated, __rowId: prev[index]?.__rowId || updated.__rowId };
            return next;
        });
        if (selectedProjectIndex === index) {
            setSelectedProject((prev) => ({ ...(prev || {}), ...updated, __rowId: prev?.__rowId || updated.__rowId }));
        }
    };

    const handleDeadlineSave = async () => {
        if (!canEditDeadline || selectedProjectIndex === null || selectedProjectIndex === undefined) return;
        setSavingDeadline(true);
        try {
            await handleDeadlineChange(selectedProjectIndex, deadlineInput || null);
        } finally {
            setSavingDeadline(false);
        }
    };

    const handleAssignmentsChange = async (projectDbId, nextUserIds) => {
        const res = await apiFetch(`${API}/projects/by-db-id/${encodeURIComponent(projectDbId)}/assignments`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userIds: nextUserIds }),
        });
        if (!res.ok) throw new Error('Failed to update assignments');
        const updated = await res.json();
        setProjects((prev) => prev.map((item) => (item.db_id === updated.db_id ? { ...item, ...updated, __rowId: item.__rowId } : item)));
        setSelectedProject((prev) => (prev?.db_id === updated.db_id ? { ...prev, ...updated, __rowId: prev.__rowId } : prev));
    };

    const toggleAssignment = async (userId) => {
        if (!selectedProject?.db_id) return;
        const assignedUserIds = selectedProject?.assigned_user_ids || [];
        const next = assignedUserIds.includes(userId)
            ? assignedUserIds.filter((item) => item !== userId)
            : [...assignedUserIds, userId];
        await handleAssignmentsChange(selectedProject.db_id, next);
    };

    const handleVoteChange = async (projectDbId, nextValue) => {
        if (!projectDbId) return;
        const previousProject = projects.find((item) => item.db_id === projectDbId);
        const previousVote = previousProject?.current_user_vote || '';
        const previousSummary = previousProject?.vote_summary || { up: 0, down: 0 };
        const optimisticSummary = {
            up: Math.max(0, (previousSummary.up || 0) + (previousVote === 'up' ? -1 : 0) + (nextValue === 'up' ? 1 : 0)),
            down: Math.max(0, (previousSummary.down || 0) + (previousVote === 'down' ? -1 : 0) + (nextValue === 'down' ? 1 : 0)),
        };
        setProjects((prev) => prev.map((item) => (
            item.db_id === projectDbId
                ? { ...item, current_user_vote: nextValue, vote_summary: optimisticSummary }
                : item
        )));
        setSelectedProject((prev) => (
            prev?.db_id === projectDbId
                ? { ...prev, current_user_vote: nextValue, vote_summary: optimisticSummary }
                : prev
        ));
        const res = await apiFetch(`${API}/projects/by-db-id/${encodeURIComponent(projectDbId)}/vote`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ value: nextValue }),
        });
        if (!res.ok) {
            setProjects((prev) => prev.map((item) => (
                item.db_id === projectDbId
                    ? { ...item, current_user_vote: previousVote, vote_summary: previousSummary }
                    : item
            )));
            setSelectedProject((prev) => (
                prev?.db_id === projectDbId
                    ? { ...prev, current_user_vote: previousVote, vote_summary: previousSummary }
                    : prev
            ));
            window.alert('Failed to update vote');
            throw new Error('Failed to update vote');
        }
        const updated = await res.json();
        setProjects((prev) => prev.map((item) => (item.db_id === updated.db_id ? { ...item, ...updated, __rowId: item.__rowId } : item)));
        setSelectedProject((prev) => (prev?.db_id === updated.db_id ? { ...prev, ...updated, __rowId: prev.__rowId } : prev));
    };

    const handleBidOutcomeChange = async (projectDbId, nextOutcome) => {
        if (!projectDbId) return;
        const previousOutcome = projects.find((item) => item.db_id === projectDbId)?.bid_outcome || '';
        setProjects((prev) => prev.map((item) => (
            item.db_id === projectDbId ? { ...item, bid_outcome: nextOutcome } : item
        )));
        setSelectedProject((prev) => (
            prev?.db_id === projectDbId ? { ...prev, bid_outcome: nextOutcome } : prev
        ));
        const res = await apiFetch(`${API}/projects/by-db-id/${encodeURIComponent(projectDbId)}/bid-outcome`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ outcome: nextOutcome }),
        });
        if (!res.ok) {
            setProjects((prev) => prev.map((item) => (
                item.db_id === projectDbId ? { ...item, bid_outcome: previousOutcome } : item
            )));
            setSelectedProject((prev) => (
                prev?.db_id === projectDbId ? { ...prev, bid_outcome: previousOutcome } : prev
            ));
            window.alert('Failed to update bid outcome');
            throw new Error('Failed to update bid outcome');
        }
        const updated = await res.json();
        setProjects((prev) => prev.map((item) => (item.db_id === updated.db_id ? { ...item, ...updated, __rowId: item.__rowId } : item)));
        setSelectedProject((prev) => (prev?.db_id === updated.db_id ? { ...prev, ...updated, __rowId: prev.__rowId } : prev));
    };

    const refreshSelectedProject = useCallback(async () => {
        if (!selectedProject?.db_id) return null;
        const res = await apiFetch(`${API}/projects/by-db-id/${encodeURIComponent(selectedProject.db_id)}`);
        if (!res.ok) return null;
        const updated = await res.json();
        setProjects((prev) => prev.map((item) => (item.db_id === updated.db_id ? { ...item, ...updated, __rowId: item.__rowId } : item)));
        setSelectedProject((prev) => (prev?.db_id === updated.db_id ? { ...prev, ...updated, __rowId: prev.__rowId } : prev));
        return updated;
    }, [selectedProject?.db_id, apiFetch, setProjects]);

    const handleSmartZiwSearch = async (projectDbId) => {
        const res = await apiFetch(`${API}/projects/by-db-id/${encodeURIComponent(projectDbId)}/smart-ziw`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ force: false }),
        });
        if (!res.ok) {
            const errorData = await res.json().catch(() => ({}));
            throw new Error(errorData?.detail || 'Failed to start Smart-Ziw Agent');
        }
        const data = await res.json().catch(() => ({}));
        const updated = data?.project;
        if (updated?.db_id) {
            setProjects((prev) => prev.map((item) => (item.db_id === updated.db_id ? { ...item, ...updated, __rowId: item.__rowId } : item)));
            setSelectedProject((prev) => (prev?.db_id === updated.db_id ? { ...prev, ...updated, __rowId: prev.__rowId } : prev));
            return;
        }
        await refreshSelectedProject();
    };

    const handleDelete = async (projectOrIndex, fallbackIndex = null) => {
        const project = typeof projectOrIndex === 'object' && projectOrIndex !== null ? projectOrIndex : null;
        const index = typeof projectOrIndex === 'number' ? projectOrIndex : fallbackIndex;
        const dbId = project?.db_id;
        const rowId = project?.__rowId;
        const started = performance.now();
        const selectedProjectSnapshot = selectedProject;
        const selectedProjectIndexSnapshot = selectedProjectIndex;
        const commentsOpenSnapshot = commentsOpen;
        const removedIndex = dbId
            ? projects.findIndex((item) => item.db_id === dbId)
            : (rowId
                ? projects.findIndex((item) => item.__rowId === rowId)
                : index);
        const removedProject = removedIndex >= 0 ? projects[removedIndex] : null;

        if (!removedProject) {
            console.warn('[delete] unable to resolve row for deletion', { dbId, rowId, index });
            return;
        }

        setProjects((prev) => {
            const removedKey = removedProject?.db_id || removedProject?.__rowId;
            const next = prev.filter((item, i) => {
                const itemKey = item?.db_id || item?.__rowId;
                if (removedKey) return itemKey !== removedKey;
                return i !== removedIndex;
            });
            const selectedKey = selectedProjectSnapshot?.db_id || selectedProjectSnapshot?.__rowId;

            if (selectedKey && removedKey && selectedKey === removedKey) {
                setSelectedProject(null);
                setSelectedProjectIndex(null);
                setCommentsOpen(false);
            } else if (selectedKey) {
                const nextIndex = next.findIndex((item) => (item.db_id || item.__rowId) === selectedKey);
                setSelectedProjectIndex(nextIndex >= 0 ? nextIndex : null);
                if (nextIndex < 0) {
                    setSelectedProject(null);
                    setCommentsOpen(false);
                }
            }
            return next;
        });

        console.debug('[delete] optimistic row removal', {
            dbId,
            rowId,
            optimisticMs: Math.round(performance.now() - started),
        });

        const requestStarted = performance.now();
        try {
            const res = dbId
                ? await apiFetch(`${API}/projects/by-db-id/${encodeURIComponent(dbId)}`, { method: 'DELETE' })
                : await apiFetch(`${API}/projects/${index}`, { method: 'DELETE' });

            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data?.detail || 'Failed to delete project');
            }

            console.debug('[delete] server response received', {
                dbId,
                rowId,
                requestMs: Math.round(performance.now() - requestStarted),
                totalMs: Math.round(performance.now() - started),
            });
        } catch (error) {
            console.error('[delete] rollback after failed delete', {
                dbId,
                rowId,
                error: error?.message || error,
                requestMs: Math.round(performance.now() - requestStarted),
            });

            if (removedProject) {
                setProjects((prev) => {
                    const exists = prev.some((item) => (item.db_id && removedProject.db_id ? item.db_id === removedProject.db_id : item.__rowId === removedProject.__rowId));
                    if (exists) return prev;
                    const next = [...prev];
                    const insertAt = Math.max(0, Math.min(removedIndex, next.length));
                    next.splice(insertAt, 0, removedProject);
                    return next;
                });
            }

            setSelectedProject(selectedProjectSnapshot);
            setSelectedProjectIndex(selectedProjectIndexSnapshot);
            setCommentsOpen(commentsOpenSnapshot);
            window.alert(error?.message || 'Failed to delete project');
        }
    };

    const handleBulkDelete = async (selectedProjects) => {
        const projectDbIds = [...new Set((selectedProjects || []).map((project) => project?.db_id).filter(Boolean))];
        if (!projectDbIds.length) {
            for (const project of selectedProjects || []) {
                const projectIndex = projects.findIndex((item) => item.__rowId === project.__rowId);
                if (projectIndex >= 0) {
                    // Fallback only when db_id is unavailable.
                    // eslint-disable-next-line no-await-in-loop
                    await handleDelete(project, projectIndex);
                }
            }
            return;
        }

        const res = await apiFetch(`${API}/projects/bulk-delete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectDbIds }),
        });
        if (!res.ok) throw new Error('Failed to delete selected projects');
        const data = await res.json();
        const deletedIds = new Set((data.deletedIds || []).map(String));
        setProjects((prev) => {
            const next = prev.filter((item) => !deletedIds.has(String(item.db_id)));
            if (selectedProject?.db_id && deletedIds.has(String(selectedProject.db_id))) {
                setSelectedProject(null);
                setSelectedProjectIndex(null);
                setCommentsOpen(false);
            } else if (selectedProject?.db_id) {
                const nextIndex = next.findIndex((item) => item.db_id === selectedProject.db_id);
                setSelectedProjectIndex(nextIndex >= 0 ? nextIndex : null);
                if (nextIndex < 0) {
                    setSelectedProject(null);
                    setCommentsOpen(false);
                }
            }
            return next;
        });
    };

    const filteredComments = useMemo(() => {
        if (!discussionSearch) return comments;
        const q = discussionSearch.toLowerCase();
        return comments.filter((c) => {
            if ((c.body || '').toLowerCase().includes(q)) return true;
            return (c.attachments || []).some((a) => (a.originalName || '').toLowerCase().includes(q));
        });
    }, [comments, discussionSearch]);

    const selectedEntity = useMemo(() => (
        selectedProject
            ? {
                type: 'project',
                id: selectedProject.project_id || selectedProject.project_name,
                label: selectedProject.project_name || selectedProject.project_description,
            }
            : null
    ), [selectedProject]);

    const selectedEntityType = selectedEntity?.type || '';
    const selectedEntityId = selectedEntity?.id || '';
    const selectedProjectShareUrl = useMemo(
        () => buildTenderShareUrl(selectedProject?.db_id || ''),
        [selectedProject?.db_id],
    );

    useEffect(() => {
        if (!selectedProject?.db_id || !projects.length) return;
        const projectIndex = projects.findIndex((item) => String(item.db_id) === String(selectedProject.db_id));
        if (projectIndex < 0) return;
        setSelectedProjectIndex(projectIndex);
        setSelectedProject((prev) => (
            prev?.db_id === projects[projectIndex]?.db_id
                ? { ...prev, ...projects[projectIndex], __rowId: projects[projectIndex].__rowId || prev.__rowId }
                : prev
        ));
    }, [projects, selectedProject?.db_id]);

    useEffect(() => {
        if (!selectedProject?.manual_deadline) {
            setDeadlineInput('');
            return;
        }
        setDeadlineInput(toInputDate(selectedProject.manual_deadline));
    }, [selectedProject?.manual_deadline]);

    const refreshComments = useCallback(async () => {
        if (!commentsOpen || !selectedEntityId) return;
        const res = await apiFetch(`/api/comments?entityType=${encodeURIComponent(selectedEntityType)}&entityId=${encodeURIComponent(selectedEntityId)}&mine=${commentsMine}`);
        setComments(await res.json());
    }, [commentsOpen, selectedEntityType, selectedEntityId, commentsMine, apiFetch]);

    useEffect(() => {
        let cancelled = false;

        const run = async () => {
            if (!authUser || !commentsOpen || !selectedEntityId) {
                setComments([]);
                return;
            }
            setCommentsLoading(true);
            try {
                const res = await apiFetch(`/api/comments?entityType=${encodeURIComponent(selectedEntityType)}&entityId=${encodeURIComponent(selectedEntityId)}&mine=${commentsMine}`);
                const data = await res.json();
                if (!cancelled) setComments(data);
            } finally {
                if (!cancelled) setCommentsLoading(false);
            }
        };

        run();
        return () => {
            cancelled = true;
        };
    }, [authUser, commentsOpen, selectedEntityType, selectedEntityId, commentsMine, apiFetch]);

    useEffect(() => {
        if (!authUser || !commentsOpen || !selectedEntityId) return undefined;
        const interval = window.setInterval(() => {
            refreshComments();
            refreshSelectedProject();
        }, 5000);
        return () => window.clearInterval(interval);
    }, [authUser, commentsOpen, selectedEntityId, refreshComments, refreshSelectedProject]);

    const submitComment = async (pendingFiles = [], mentions = [], onFilesClear = null) => {
        if ((!commentsBody.trim() && !pendingFiles.length) || !selectedEntityId) return;
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
        const res = await apiFetch('/api/comments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                entityType: selectedEntityType,
                entityId: selectedEntityId,
                projectDbId: selectedProject?.db_id || '',
                body: text || ' ',
                attachments,
                mentions,
            }),
        });
        if (!res.ok) throw new Error('Failed to post comment');
        const created = await res.json().catch(() => null);
        const attachmentCount = attachments.length;
        if (selectedProject?.db_id) {
            setProjects((prev) => prev.map((item) => (
                item.db_id === selectedProject.db_id
                    ? {
                        ...item,
                        comment_count: (item.comment_count || 0) + 1,
                        comment_document_count: (item.comment_document_count || 0) + attachmentCount,
                      }
                    : item
            )));
            setSelectedProject((prev) => (prev ? {
                ...prev,
                comment_count: (prev.comment_count || 0) + 1,
                comment_document_count: (prev.comment_document_count || 0) + attachmentCount,
              } : prev));
        }
        if (created?.comment) {
            setComments((prev) => prev.map((item) => (item.id === optimistic.id ? created.comment : item)));
        }
        await refreshComments();
    };

    const openProjectByDbId = useCallback(async (projectDbId) => {
        if (!projectDbId || !authUser || authUser.mustChangePassword) return;
        const localProject = projects.find((item) => String(item.db_id) === String(projectDbId));
        let project = localProject;
        if (!project) {
            const res = await apiFetch(`${API}/projects/by-db-id/${encodeURIComponent(projectDbId)}`);
            if (!res.ok) throw new Error('Tender not found');
            project = await res.json();
        }
        const projectIndex = projects.findIndex((item) => String(item.db_id) === String(projectDbId));
        setSelectedProject(project);
        setSelectedProjectIndex(projectIndex >= 0 ? projectIndex : null);
        setCommentsOpen(true);
    }, [authUser, projects, apiFetch]);

    useEffect(() => {
        if (!isTenderSheetHash(sheetHash) || !authUser || authUser.mustChangePassword) return undefined;
        const tenderId = getTenderIdFromHash(sheetHash);
        if (!tenderId) return undefined;
        if (commentsOpen && String(selectedProject?.db_id || '') === String(tenderId)) return undefined;

        let cancelled = false;
        openProjectByDbId(tenderId).catch(() => {
            if (!cancelled) window.alert('Tender not found or no longer available.');
        });
        return () => {
            cancelled = true;
        };
    }, [authUser, commentsOpen, selectedProject?.db_id, openProjectByDbId, sheetHash]);

    const clearActiveProject = useCallback(() => {
        setSelectedProject(null);
        setSelectedProjectIndex(null);
        setCommentsOpen(false);
        if (isTenderSheetHash(window.location.hash) || isTenderFullPageHash(window.location.hash)) {
            window.location.hash = '#dashboard';
        }
    }, []);

    useEffect(() => {
        if (!commentsOpen) return undefined;
        const onKey = (e) => {
            if (e.key === 'Escape') clearActiveProject();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [commentsOpen, clearActiveProject]);

    const handleCopyShareUrl = async () => {
        if (!selectedProjectShareUrl) return;
        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(selectedProjectShareUrl);
            } else {
                const tempInput = document.createElement('input');
                tempInput.value = selectedProjectShareUrl;
                tempInput.setAttribute('readonly', '');
                tempInput.style.position = 'fixed';
                tempInput.style.opacity = '0';
                document.body.appendChild(tempInput);
                tempInput.select();
                document.execCommand('copy');
                document.body.removeChild(tempInput);
            }
            setShareCopied(true);
            window.setTimeout(() => setShareCopied(false), 1800);
        } catch {
            window.prompt('Copy tender link', selectedProjectShareUrl);
        }
    };

    function attachmentKindFromUrl(url = '') {
        const lower = String(url).toLowerCase();
        if (/\.(png|jpe?g|webp|gif|bmp|svg)($|\?)/i.test(lower)) return 'image';
        if (/\.pdf($|\?)/i.test(lower)) return 'pdf';
        return 'other';
    }

    const handleAttachmentClick = useCallback((event) => {
        const link = event.target.closest('a[href]');
        if (!link) return;
        const url = link.getAttribute('href');
        if (!url) return;
        const kind = attachmentKindFromUrl(url);
        if (kind === 'other') return;
        event.preventDefault();
        event.stopPropagation();
        setPreviewAttachment({ url, kind, originalName: link.textContent || url.split('/').pop() || 'attachment' });
    }, []);

    return (
        <div className="flex flex-col gap-6">
            <div className="flex min-w-0 flex-1 flex-col gap-6">
                <div className="tender-stats-cards grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
                    <div className="rounded-lg bg-muted/40 p-4">
                        <div className="flex flex-col gap-1.5">
                            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Total Tenders</span>
                            <span className="text-2xl font-semibold tracking-tight text-foreground">{dashboardStats.total}</span>
                            <span className="text-xs text-muted-foreground">Across {dashboardStats.sourcesCount} sources</span>
                        </div>
                    </div>
                    <div className="rounded-lg bg-muted/40 p-4">
                        <div className="flex flex-col gap-1.5">
                            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">New This Week</span>
                            <span className="text-2xl font-semibold tracking-tight text-foreground">{dashboardStats.newThisWeek}</span>
                            <span className="text-xs text-muted-foreground">Scraped this week</span>
                        </div>
                    </div>
                    <div className="rounded-lg bg-muted/40 p-4">
                        <div className="flex flex-col gap-1.5">
                            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Pending Review</span>
                            <span className="text-2xl font-semibold tracking-tight text-foreground">{dashboardStats.pendingReview}</span>
                            <span className="text-xs text-muted-foreground">Awaiting decision</span>
                        </div>
                    </div>
                    <div className="rounded-lg bg-muted/40 p-4">
                        <div className="flex flex-col gap-1.5">
                            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Expiring Soon</span>
                            <span className="text-2xl font-semibold tracking-tight text-foreground">{dashboardStats.expiringSoon}</span>
                            <span className="text-xs text-muted-foreground"><strong className="font-semibold text-primary">30</strong> day window</span>
                        </div>
                    </div>
                    <div className="rounded-lg bg-muted/40 p-4">
                        <div className="flex flex-col gap-1.5">
                            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Win Rate</span>
                            <span className="text-2xl font-semibold tracking-tight text-foreground">{dashboardStats.bidWinRate === null ? '—' : `${dashboardStats.bidWinRate}%`}</span>
                            <span className="text-xs text-muted-foreground">
                                {dashboardStats.goBidCount
                                    ? `${dashboardStats.goWinRate}% when Smart-Ziw said GO (${dashboardStats.goBidCount} bid${dashboardStats.goBidCount === 1 ? '' : 's'})`
                                    : `${dashboardStats.bidDecided} outcome${dashboardStats.bidDecided === 1 ? '' : 's'} recorded`}
                            </span>
                        </div>
                    </div>
                </div>

                <DeadlineRadar
                    projects={projects}
                    onOpenTender={(dbId) => openProjectByDbId(dbId).catch(() => {})}
                    onViewAll={() => setExpiringSoonOnly(true)}
                />
                <ProjectTable
                    projects={filtered}
                    allProjects={projects}
                    loading={projectsLoading}
                    error={projectsError}
                    onRetry={loadProjects}
                    onDecisionChange={handleDecisionChange}
                    onDelete={handleDelete}
                    onBulkDelete={handleBulkDelete}
                    regions={regions}
                    chips={chips}
                    onChipsChange={setChips}
                    freeText={freeText}
                    onFreeTextChange={setFreeText}
                    source={source}
                    onSourceChange={setSource}
                    region={region}
                    onRegionChange={setRegion}
                    continent={continent}
                    onContinentChange={setContinent}
                    continents={continents}
                    verified={verified}
                    onVerifiedChange={setVerified}
                    sources={sources}
                    decision={decision}
                    onDecisionChangeFilter={setDecision}
                    deadlineFrom={endDateFrom}
                    deadlineTo={endDateTo}
                    onDeadlineFromChange={setEndDateFrom}
                    onDeadlineToChange={setEndDateTo}
                    scrapedFrom={scrapedFrom}
                    scrapedTo={scrapedTo}
                    onScrapedFromChange={setScrapedFrom}
                    onScrapedToChange={setScrapedTo}
                    onClearFilters={clearFilters}
                    expiringSoonOnly={expiringSoonOnly}
                    expiringSoonDays={expiringSoonDays}
                    onToggleExpiringSoon={() => setExpiringSoonOnly((prev) => !prev)}
                    onExpiringSoonDaysChange={(value) => setExpiringSoonDays(Math.max(1, Math.min(365, Number(value) || 1)))}
                    savedSearches={savedSearches}
                    savedSearchNewCounts={savedSearchNewCounts}
                    onSaveCurrentSearch={handleSaveCurrentSearch}
                    onApplySavedSearch={handleApplySavedSearch}
                    onDeleteSavedSearch={handleDeleteSavedSearch}
                    canManageDecision={canManageDecision}
                    activeProjectId={selectedEntityId}
                    onClearActiveProject={clearActiveProject}
                    onStartDemo={onStartDemo}
                    onOpenFullPage={(project) => {
                        if (project?.db_id) {
                            window.location.hash = buildFullPageHash(project.db_id);
                        }
                    }}
                    onProjectSelect={(project, projectIndex) => {
                        setSelectedProject(project);
                        setSelectedProjectIndex(projectIndex);
                        setCommentsOpen(true);
                        if (project?.db_id) {
                            window.location.hash = buildSheetHash(project.db_id);
                        }
                    }}
                    newProjectIds={newProjectIds}
                />
            </div>

            <Sheet open={commentsOpen} onOpenChange={(next) => { if (!next) clearActiveProject(); }}>
                <SheetContent
                    side="right"
                    showCloseButton={false}
                    className="!w-full !max-w-none gap-0 p-0 flex flex-col overflow-hidden overscroll-contain sm:!w-[50vw] transition-transform duration-300 ease-out data-[state=closed]:translate-x-full data-[state=open]:translate-x-0"
                >
                    <SheetHeader className="sticky top-0 z-10 flex shrink-0 flex-row items-start justify-between gap-4 border-b bg-popover p-5">
                        <div className="min-w-0">
                            <SheetDescription className="text-xs font-medium uppercase tracking-wide">Project inspector</SheetDescription>
                            <SheetTitle className="mt-1 text-lg leading-snug">
                                {selectedProject?.project_name || selectedProject?.project_description || 'No project selected'}
                            </SheetTitle>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                            <ShadcnButton
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={handleCopyShareUrl}
                                disabled={!selectedProjectShareUrl}
                            >
                                {shareCopied ? 'Copied' : 'Copy link'}
                            </ShadcnButton>
                            <SheetClose asChild>
                                <ShadcnButton variant="ghost" size="icon-sm" className="transition-colors duration-200" aria-label="Close project inspector">
                                    <X />
                                </ShadcnButton>
                            </SheetClose>
                        </div>
                    </SheetHeader>

                    {selectedProject ? (
                        <>
                            <TenderSheetPanel
                                project={selectedProject}
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

                            <div className="min-h-0 flex-1 overflow-y-auto" onClick={handleAttachmentClick}>
                                <ProjectInspector
                                    project={selectedProject}
                                    comments={filteredComments}
                                    commentsLoading={commentsLoading}
                                    authUser={authUser}
                                    availableUsers={availableUsers}
                                    canManageDecision={canManageDecision}
                                    onDecisionChange={(nextDecision) => handleDecisionChange(selectedProjectIndex, nextDecision)}
                                    onBidOutcomeChange={(nextOutcome) => handleBidOutcomeChange(selectedProject.db_id, nextOutcome)}
                                    onOpenFullPage={() => { window.location.hash = buildFullPageHash(selectedProject.db_id); }}
                                    onRunSmartZiw={() => handleSmartZiwSearch(selectedProject.db_id)}
                                    compact
                                />
                            </div>

                            <CommentComposer
                                entity={selectedEntity}
                                body={commentsBody}
                                setBody={setCommentsBody}
                                onSubmit={submitComment}
                                currentUser={authUser}
                                availableUsers={availableUsers}
                                apiFetch={apiFetch}
                                className="bg-popover shrink-0"
                            />

                            {previewAttachment ? (
                                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setPreviewAttachment(null)}>
                                    <div className={`flex w-full flex-col overflow-hidden rounded-xl bg-card shadow-xl ${previewAttachment.kind === 'pdf' ? 'h-full max-w-4xl' : 'max-w-2xl'}`} onClick={(e) => e.stopPropagation()}>
                                        <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
                                            <span className="min-w-0 truncate text-sm font-medium text-foreground">{previewAttachment.originalName || 'Attachment'}</span>
                                            <div className="flex shrink-0 items-center gap-1">
                                                <a
                                                    className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors duration-200 hover:bg-muted hover:text-foreground"
                                                    href={previewAttachment.url}
                                                    download={previewAttachment.originalName || 'attachment'}
                                                    aria-label="Download attachment"
                                                    title="Download"
                                                >
                                                    ↓
                                                </a>
                                                <button
                                                    type="button"
                                                    className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors duration-200 hover:bg-muted hover:text-foreground"
                                                    onClick={() => setPreviewAttachment(null)}
                                                    aria-label="Close attachment preview"
                                                    title="Close"
                                                >
                                                    ×
                                                </button>
                                            </div>
                                        </div>
                                        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-muted p-4">
                                            {previewAttachment.kind === 'pdf' ? (
                                                <iframe
                                                    className="h-full min-h-0 w-full rounded-lg border bg-background"
                                                    src={previewAttachment.url}
                                                    title={previewAttachment.originalName || 'PDF preview'}
                                                />
                                            ) : (
                                                <img
                                                    className="max-h-full max-w-full object-contain"
                                                    src={previewAttachment.url}
                                                    alt={previewAttachment.originalName || 'attachment'}
                                                />
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ) : null}
                        </>
                    ) : null}
                </SheetContent>
            </Sheet>
        </div>
    );
}
