import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import ProjectTable from '../components/ProjectTable';
import ProjectInspector from '../components/ProjectInspector';
import { Button as ShadcnButton } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
    Sheet,
    SheetClose,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { Input as ShadcnInput } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Avatar as ShadcnAvatar, AvatarFallback } from '@/components/ui/avatar';
import { Paperclip, Send, X, Search, ThumbsUp, ThumbsDown } from 'lucide-react';
import {
    getTenderIdFromHash,
    buildTenderHash,
    buildTenderShareUrl,
    buildDashboardHash,
    deserializeFilters,
} from '../utils/tenderRouting';

const API = '/api';

const COMMENT_IMAGE_UPLOAD_TARGET_BYTES = 1.5 * 1024 * 1024;
const COMMENT_IMAGE_UPLOAD_RETRY_BYTES = 900 * 1024;
const COMMENT_IMAGE_MAX_DIMENSION = 1800;
const COMMENT_FILE_UPLOAD_LIMIT_MB = 50;

function initials(name = '', email = '') {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    if (parts.length === 1) return parts[0][0].toUpperCase();
    return (email[0] || '?').toUpperCase();
}

function colorFromSeed(seed = '') {
    let hash = 0;
    for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) % 360;
    return `hsl(${hash} 45% 46%)`;
}

function isCompressibleImage(file) {
    return Boolean(file?.type && file.type.startsWith('image/') && !file.type.includes('svg') && !file.type.includes('gif'));
}

function loadImageFromFile(file) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            URL.revokeObjectURL(url);
            resolve(img);
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('Failed to read image'));
        };
        img.src = url;
    });
}

async function compressImageForCommentUpload(file, targetBytes = COMMENT_IMAGE_UPLOAD_TARGET_BYTES) {
    if (!isCompressibleImage(file)) return file;
    if (file.size <= targetBytes) return file;

    const image = await loadImageFromFile(file);
    const largestSide = Math.max(image.width, image.height) || 1;
    const scale = Math.min(1, COMMENT_IMAGE_MAX_DIMENSION / largestSide);
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) return file;
    context.drawImage(image, 0, 0, width, height);

    const outputType = 'image/webp';
    const qualitySteps = [0.9, 0.82, 0.74, 0.66, 0.58, 0.5, 0.42];

    for (const quality of qualitySteps) {
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, outputType, quality));
        if (!blob) continue;
        const ext = file.name && file.name.includes('.') ? file.name.replace(/\.[^.]+$/, '.webp') : `${file.name || 'image'}.webp`;
        const compressed = new File([blob], ext, { type: outputType, lastModified: file.lastModified || Date.now() });
        if (compressed.size <= targetBytes || quality === qualitySteps[qualitySteps.length - 1]) {
            return compressed.size < file.size ? compressed : file;
        }
    }

    return file;
}

async function prepareCommentUploadFile(file, targetBytes = COMMENT_IMAGE_UPLOAD_TARGET_BYTES) {
    if (!file) return file;
    if (isCompressibleImage(file)) {
        return compressImageForCommentUpload(file, targetBytes);
    }
    return file;
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

function PageHeader({ title, subtitle, action, className = '' }) {
    return (
        <div className={`mb-6 ${className}`.trim()}>
            <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="min-w-0">
                    <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
                </div>
                {action ? <div className="flex items-center gap-2">{action}</div> : null}
            </div>
            {subtitle ? <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p> : null}
        </div>
    );
}

function CommentComposer({
    entity,
    body,
    setBody,
    onSubmit,
    currentUser,
    availableUsers,
    apiFetch,
}) {
    const fileInputRef = useRef(null);
    const textAreaRef = useRef(null);
    const [pendingFiles, setPendingFiles] = useState([]);
    const [uploading, setUploading] = useState(false);
    const [composerFocused, setComposerFocused] = useState(false);
    const [mentionState, setMentionState] = useState({ open: false, query: '', start: -1, end: -1, index: 0 });
    const [selectedMentions, setSelectedMentions] = useState([]);
    const [mentionUsers, setMentionUsers] = useState([]);

    useEffect(() => {
        setBody('');
        setPendingFiles([]);
        setSelectedMentions([]);
        setMentionState({ open: false, query: '', start: -1, end: -1, index: 0 });
        setComposerFocused(false);
    }, [entity?.id, setBody]);

    useEffect(() => {
        const el = textAreaRef.current;
        if (!el) return;
        el.style.height = '42px';
        const nextHeight = Math.min(Math.max(el.scrollHeight, 42), 132);
        el.style.height = `${nextHeight}px`;
        el.style.overflowY = el.scrollHeight > 132 ? 'auto' : 'hidden';
    }, [body]);

    useEffect(() => {
        if (Array.isArray(availableUsers) && availableUsers.length) {
            setMentionUsers(availableUsers);
            return;
        }
        let cancelled = false;
        apiFetch('/api/users')
            .then((res) => (res.ok ? res.json() : []))
            .then((data) => {
                if (!cancelled) setMentionUsers(Array.isArray(data) ? data : []);
            })
            .catch(() => {
                if (!cancelled) setMentionUsers([]);
            });
        return () => {
            cancelled = true;
        };
    }, [availableUsers, apiFetch]);

    const mentionCandidates = useMemo(() => {
        const query = mentionState.query.trim().toLowerCase();
        if (!mentionState.open) return [];
        return (mentionUsers || [])
            .filter((user) => user.id !== currentUser?.id)
            .filter((user) => {
                if (!query) return true;
                return `${user.name || ''} ${user.email || ''}`.toLowerCase().includes(query);
            })
            .slice(0, 6);
    }, [mentionUsers, currentUser?.id, mentionState]);

    const updateMentionState = (value, caret) => {
        const nextCaret = typeof caret === 'number' ? caret : value.length;
        const beforeCaret = value.slice(0, nextCaret);
        const match = beforeCaret.match(/(^|\s)@([A-Za-z0-9._-]*)$/);
        if (!match) {
            setMentionState({ open: false, query: '', start: -1, end: -1, index: 0 });
            return;
        }
        const query = match[2] || '';
        setMentionState({
            open: true,
            query,
            start: nextCaret - query.length - 1,
            end: nextCaret,
            index: 0,
        });
    };

    const insertMention = (user) => {
        const label = user?.name || user?.email || '';
        if (!label || mentionState.start < 0) return;
        const start = mentionState.start;
        const end = mentionState.end < 0 ? body.length : mentionState.end;
        const nextValue = `${body.slice(0, start)}@${label} ${body.slice(end)}`;
        setBody(nextValue);
        setSelectedMentions((prev) => {
            const next = prev.filter((item) => item.userId !== user.id);
            next.push({ userId: user.id, name: user.name, email: user.email });
            return next;
        });
        setMentionState({ open: false, query: '', start: -1, end: -1, index: 0 });
        requestAnimationFrame(() => {
            if (!textAreaRef.current) return;
            const cursorPos = start + label.length + 2;
            textAreaRef.current.focus();
            textAreaRef.current.setSelectionRange(cursorPos, cursorPos);
        });
    };

    const handleKeyDown = (e) => {
        if (mentionState.open && mentionCandidates.length) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setMentionState((prev) => ({ ...prev, index: (prev.index + 1) % mentionCandidates.length }));
                return;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                setMentionState((prev) => ({ ...prev, index: (prev.index - 1 + mentionCandidates.length) % mentionCandidates.length }));
                return;
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                insertMention(mentionCandidates[mentionState.index] || mentionCandidates[0]);
                return;
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                setMentionState({ open: false, query: '', start: -1, end: -1, index: 0 });
                return;
            }
        }
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if ((body.trim() || pendingFiles.length) && entity?.id) handleSubmit();
        }
    };

    const handleFileChange = async (e) => {
        const files = Array.from(e.target.files || []);
        if (!files.length || !entity?.id) return;
        setUploading(true);
        try {
            for (const file of files) {
                let uploadFile = await prepareCommentUploadFile(file);

                const sendUpload = async (currentFile) => {
                    const fd = new FormData();
                    fd.append('entityType', entity.type || 'project');
                    fd.append('entityId', entity.id);
                    fd.append('file', currentFile);
                    return apiFetch('/api/comments/upload', {
                        method: 'POST',
                        body: fd,
                    });
                };

                let res = await sendUpload(uploadFile);

                if (res.status === 413 && isCompressibleImage(file)) {
                    uploadFile = await prepareCommentUploadFile(file, COMMENT_IMAGE_UPLOAD_RETRY_BYTES);
                    res = await sendUpload(uploadFile);
                }

                if (res.ok) {
                    const att = await res.json();
                    setPendingFiles((prev) => [...prev, att]);
                    continue;
                }

                const err = await res.json().catch(() => ({}));
                const message = res.status === 413
                    ? `File is too large. Uploads are limited to ${COMMENT_FILE_UPLOAD_LIMIT_MB} MB.`
                    : (err.detail || `Upload failed (${res.status})`);
                window.alert(message);
            }
        } finally {
            setUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const removeFile = (fileId) => setPendingFiles((prev) => prev.filter((f) => f.fileId !== fileId));

    const handleSubmit = () => {
        const mentions = selectedMentions.filter((mention) => body.includes(`@${mention.name || mention.email}`));
        return onSubmit(pendingFiles, mentions, () => {
            setPendingFiles([]);
            setSelectedMentions([]);
            setMentionState({ open: false, query: '', start: -1, end: -1, index: 0 });
        });
    };

    return (
        <div className="border-t p-4">
            {pendingFiles.length > 0 ? (
                <div className="flex flex-wrap gap-2 pb-3">
                    {pendingFiles.map((f) => (
                        <Badge key={f.fileId} variant="secondary" className="gap-1.5 pr-1 font-normal">
                            {f.originalName}
                            <button
                                type="button"
                                className="inline-flex size-4 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                                onClick={() => removeFile(f.fileId)}
                                title="Remove"
                            >
                                x
                            </button>
                        </Badge>
                    ))}
                </div>
            ) : null}
            <div className="relative flex items-end gap-2">
                <input
                    ref={fileInputRef}
                    type="file"
                    name="discussionAttachments"
                    multiple
                    style={{ display: 'none' }}
                    onChange={handleFileChange}
                />
                <ShadcnButton
                    type="button"
                    variant="outline"
                    size="icon"
                    className="shrink-0"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    title="Attach file"
                    aria-label="Attach file"
                >
                    <Paperclip />
                </ShadcnButton>
                <Textarea
                    ref={textAreaRef}
                    className="min-h-0 flex-1 resize-none px-3.5 py-2.5"
                    style={{ fieldSizing: 'fixed' }}
                    name="discussionMessage"
                    aria-label="Discussion message"
                    value={body}
                    onChange={(e) => {
                        setBody(e.target.value);
                        updateMentionState(e.target.value, e.target.selectionStart);
                    }}
                    onKeyDown={handleKeyDown}
                    onFocus={() => setComposerFocused(true)}
                    onBlur={() => setComposerFocused(Boolean(body.trim()))}
                    placeholder="Type a message... Use @ to mention someone"
                    rows={1}
                />
                {mentionState.open && mentionCandidates.length ? (
                    <div className="absolute bottom-full left-0 right-0 z-10 mb-2 flex flex-col gap-1 rounded-lg border bg-popover p-1 shadow-lg">
                        {mentionCandidates.map((user, index) => (
                            <button
                                key={user.id}
                                type="button"
                                className={`flex items-center gap-2 rounded-md px-2.5 py-2 text-left ${index === mentionState.index ? 'bg-muted' : 'bg-transparent hover:bg-muted'}`}
                                onMouseDown={(event) => {
                                    event.preventDefault();
                                    insertMention(user);
                                }}
                            >
                                <ShadcnAvatar className="size-6 shrink-0" style={{ background: colorFromSeed(user.name || user.email || '') }}>
                                    <AvatarFallback className="bg-transparent text-[10px] font-bold uppercase tracking-wide text-white">
                                        {initials(user.name || '', user.email || '')}
                                    </AvatarFallback>
                                </ShadcnAvatar>
                                <div className="flex min-w-0 flex-col">
                                    <span className="text-sm font-semibold text-foreground">{user.name || user.email}</span>
                                    {user.email ? <span className="text-xs text-muted-foreground">{user.email}</span> : null}
                                </div>
                            </button>
                        ))}
                    </div>
                ) : null}
                <ShadcnButton
                    type="button"
                    size="icon"
                    className="size-9 shrink-0 rounded-full"
                    onClick={handleSubmit}
                    disabled={(!body.trim() && !pendingFiles.length) || !entity?.id || uploading}
                    title="Send"
                    aria-label="Send message"
                >
                    <Send />
                </ShadcnButton>
            </div>
        </div>
    );
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

    // URL-synced filters: read once on mount.
    useEffect(() => {
        const hash = window.location.hash || '';
        const queryIndex = hash.indexOf('?');
        const search = queryIndex >= 0 ? hash.slice(queryIndex + 1) : '';
        const parsed = deserializeFilters(search);
        setFreeText(parsed.q);
        setSource(parsed.source);
        setRegion(parsed.region);
        setContinent(parsed.continent);
        setVerified(parsed.verified);
        setDecision(parsed.decision);
        setEndDateFrom(parsed.deadlineFrom);
        setEndDateTo(parsed.deadlineTo);
        setScrapedFrom(parsed.scrapedFrom);
        setScrapedTo(parsed.scrapedTo);
        setExpiringSoonOnly(parsed.expiringSoon === '1');
        setExpiringSoonDays(Number(parsed.expiringDays) || 5);
    }, []);

    // URL-synced filters: write on every change.
    useEffect(() => {
        if (getTenderIdFromHash(window.location.hash)) return;
        const filters = {
            q: freeText,
            source,
            region,
            continent,
            verified,
            decision,
            deadlineFrom: endDateFrom,
            deadlineTo: endDateTo,
            scrapedFrom,
            scrapedTo,
            expiringSoon: expiringSoonOnly ? '1' : '0',
            expiringDays: String(expiringSoonDays),
        };
        const nextHash = buildDashboardHash(filters);
        if (nextHash !== `#${window.location.hash.replace(/^#/, '')}`) {
            window.location.hash = nextHash;
        }
    }, [
        freeText, source, region, continent, verified, decision,
        endDateFrom, endDateTo, scrapedFrom, scrapedTo,
        expiringSoonOnly, expiringSoonDays,
    ]);

    const getRegion = useCallback((sponsor) => {
        if (!sponsor) return '';
        const lower = sponsor.toLowerCase();
        for (const [regionName, countries] of Object.entries(regions || {})) {
            if (countries.some((c) => lower.includes(c.toLowerCase()))) return regionName;
        }
        return '';
    }, [regions]);

    const filtered = useMemo(() => {
        const ft = freeText.toLowerCase();
        const parseFilterDate = (value) => {
            if (!value) return null;
            const direct = new Date(value);
            if (!Number.isNaN(direct.getTime())) return direct;
            const parts = String(value).split('/');
            if (parts.length === 3) {
                const parsed = new Date(parts[2], parts[0] - 1, parts[1]);
                if (!Number.isNaN(parsed.getTime())) return parsed;
            }
            return null;
        };
        const chipGroups = chips.reduce((acc, chip) => {
            const field = String(chip.field || '').toLowerCase();
            if (!['source', 'region', 'continent', 'country'].includes(field)) return acc;
            if (!acc[field]) acc[field] = [];
            acc[field].push(String(chip.value || '').toLowerCase());
            return acc;
        }, {});
        const deadlineFromDate = endDateFrom ? new Date(endDateFrom) : null;
        const deadlineToDate = endDateTo ? new Date(endDateTo) : null;
        const scrapedFromDate = scrapedFrom ? new Date(scrapedFrom) : null;
        const scrapedToDate = scrapedTo ? new Date(scrapedTo) : null;
        const expiringWindowStart = new Date();
        expiringWindowStart.setHours(0, 0, 0, 0);
        const expiringWindowEnd = new Date(expiringWindowStart);
        expiringWindowEnd.setDate(expiringWindowEnd.getDate() + expiringSoonDays);
        expiringWindowEnd.setHours(23, 59, 59, 999);
        if (deadlineToDate) deadlineToDate.setHours(23, 59, 59, 999);
        if (scrapedToDate) scrapedToDate.setHours(23, 59, 59, 999);
        return projects.filter((p) => {
            if (ft && ![p.project_id, p.project_name, p.project_description, p.project_sponsor].join(' ').toLowerCase().includes(ft)) return false;
            if (source && p.source !== source) return false;
            if (verified && p.ai_verified !== verified) return false;
            const projectRegions = (p.region_names || []).map((name) => String(name).toLowerCase());
            if (region) {
                const regionValue = String(region).toLowerCase();
                const sponsor = (p.project_sponsor || '').toLowerCase();
                const fallbackCountries = (regions[region] || []).map((c) => c.toLowerCase());
                const regionMatch = projectRegions.includes(regionValue) || (fallbackCountries.length > 0 && fallbackCountries.some((c) => sponsor.includes(c)));
                if (!regionMatch) return false;
            }
            if (continent) {
                const continentValue = String(continent).toLowerCase();
                const projectContinents = [
                    ...(p.continent_codes || []).map((code) => String(code).toLowerCase()),
                    ...(p.continent_names_en || []).map((name) => String(name).toLowerCase()),
                    ...(p.continent_names_fr || []).map((name) => String(name).toLowerCase()),
                ];
                if (!projectContinents.includes(continentValue)) return false;
            }
            if (chipGroups.source?.length) {
                const projectSource = String(p.source || '').toLowerCase();
                if (!chipGroups.source.some((value) => projectSource.includes(value))) return false;
            }
            if (chipGroups.region?.length) {
                if (!chipGroups.region.some((value) => projectRegions.includes(value))) return false;
            }
            if (chipGroups.continent?.length) {
                const projectContinents = [
                    ...(p.continent_codes || []).map((code) => String(code).toLowerCase()),
                    ...(p.continent_names_en || []).map((name) => String(name).toLowerCase()),
                    ...(p.continent_names_fr || []).map((name) => String(name).toLowerCase()),
                ];
                if (!chipGroups.continent.some((value) => projectContinents.includes(value))) return false;
            }
            if (chipGroups.country?.length) {
                const projectCountries = [
                    ...(p.country_names_en || []).map((name) => String(name).toLowerCase()),
                    ...(p.country_names_fr || []).map((name) => String(name).toLowerCase()),
                    String(p.project_sponsor || '').toLowerCase(),
                ];
                if (!chipGroups.country.some((value) => projectCountries.some((countryValue) => countryValue.includes(value)))) return false;
            }
            if (decision === 'Undecided' && p.decision) return false;
            if (decision && decision !== 'Undecided' && p.decision !== decision) return false;
            const projectDeadline = parseFilterDate(p.effective_deadline || p.manual_deadline || p.scraped_deadline || p.project_end_date);
            if (deadlineFromDate && (!projectDeadline || projectDeadline < deadlineFromDate)) return false;
            if (deadlineToDate && (!projectDeadline || projectDeadline > deadlineToDate)) return false;
            if (expiringSoonOnly) {
                if (p.ai_verified !== 'Yes') return false;
                if (!projectDeadline || projectDeadline < expiringWindowStart || projectDeadline > expiringWindowEnd) return false;
            }
            const scrapedAt = parseFilterDate(p.scraped_at);
            if (scrapedFromDate && (!scrapedAt || scrapedAt < scrapedFromDate)) return false;
            if (scrapedToDate && (!scrapedAt || scrapedAt > scrapedToDate)) return false;
            return true;
        });
    }, [projects, chips, freeText, source, verified, region, continent, regions, decision, endDateFrom, endDateTo, scrapedFrom, scrapedTo, getRegion, expiringSoonOnly, expiringSoonDays]);

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

    const handleSaveCurrentSearch = useCallback(async () => {
        const name = window.prompt('Saved search name');
        if (!name || !name.trim()) return;
        const now = new Date().toISOString();
        const next = [
            {
                id: `search-${Date.now()}`,
                name: name.trim(),
                filters: buildCurrentFilterState(),
                createdAt: now,
                updatedAt: now,
            },
            ...savedSearches.filter((item) => item.name.trim().toLowerCase() !== name.trim().toLowerCase()),
        ];
        await persistSavedSearches(next);
    }, [buildCurrentFilterState, savedSearches, persistSavedSearches]);

    const handleApplySavedSearch = useCallback((searchId) => {
        const match = savedSearches.find((item) => item.id === searchId);
        if (!match) return;
        applySavedFilterState(match.filters || {});
    }, [savedSearches, applySavedFilterState]);

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
        const tenderId = getTenderIdFromHash(window.location.hash);
        if (!tenderId || !authUser || authUser.mustChangePassword) return undefined;
        if (commentsOpen && String(selectedProject?.db_id || '') === String(tenderId)) return undefined;

        let cancelled = false;
        openProjectByDbId(tenderId).catch(() => {
            if (!cancelled) window.alert('Tender not found or no longer available.');
        });
        return () => {
            cancelled = true;
        };
    }, [authUser, commentsOpen, selectedProject?.db_id, openProjectByDbId]);

    const clearActiveProject = useCallback(() => {
        setSelectedProject(null);
        setSelectedProjectIndex(null);
        setCommentsOpen(false);
        if (getTenderIdFromHash(window.location.hash)) {
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
                <PageHeader
                    title="Procurement Watch"
                    subtitle="Track tenders, review sources, and manage decisions."
                />
                <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <Card>
                        <CardContent className="flex flex-col gap-1.5">
                            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Total Tenders</span>
                            <span className="text-3xl font-bold tracking-tight text-foreground">{dashboardStats.total}</span>
                            <span className="text-sm text-muted-foreground">Across {dashboardStats.sourcesCount} sources</span>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="flex flex-col gap-1.5">
                            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">New This Week</span>
                            <span className="text-3xl font-bold tracking-tight text-foreground">{dashboardStats.newThisWeek}</span>
                            <span className="text-sm text-muted-foreground">Scraped this week</span>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="flex flex-col gap-1.5">
                            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Pending Review</span>
                            <span className="text-3xl font-bold tracking-tight text-foreground">{dashboardStats.pendingReview}</span>
                            <span className="text-sm text-muted-foreground">Awaiting decision</span>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="flex flex-col gap-1.5">
                            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Expiring Soon</span>
                            <span className="text-3xl font-bold tracking-tight text-foreground">{dashboardStats.expiringSoon}</span>
                            <span className="text-sm text-muted-foreground"><strong className="font-semibold text-primary">30</strong> day window</span>
                        </CardContent>
                    </Card>
                </div>
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
                    onSaveCurrentSearch={handleSaveCurrentSearch}
                    onApplySavedSearch={handleApplySavedSearch}
                    onDeleteSavedSearch={handleDeleteSavedSearch}
                    canManageDecision={canManageDecision}
                    activeProjectId={selectedEntityId}
                    onClearActiveProject={clearActiveProject}
                    onStartDemo={onStartDemo}
                    onProjectSelect={(project, projectIndex) => {
                        setSelectedProject(project);
                        setSelectedProjectIndex(projectIndex);
                        setCommentsOpen(true);
                        if (project?.db_id) {
                            window.location.hash = buildTenderHash(project.db_id);
                        }
                    }}
                    newProjectIds={newProjectIds}
                />
            </div>

            <Sheet open={commentsOpen} onOpenChange={(next) => { if (!next) clearActiveProject(); }}>
                <SheetContent
                    side="right"
                    showCloseButton={false}
                    className="!w-full !max-w-none gap-0 p-0 sm:!w-[50vw] flex flex-col"
                >
                    <SheetHeader className="flex flex-row items-start justify-between gap-4 border-b p-5">
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
                                <ShadcnButton variant="ghost" size="icon-sm" aria-label="Close project inspector">
                                    <X />
                                </ShadcnButton>
                            </SheetClose>
                        </div>
                    </SheetHeader>

                    {selectedProject ? (
                        <>
                            <div className="border-b p-4 space-y-4 overflow-y-auto max-h-[40vh]">
                                <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-baseline gap-2">
                                        <h3 className="text-sm font-semibold">Discussion</h3>
                                        <span className="text-xs text-muted-foreground">{comments.length} notes</span>
                                    </div>
                                    <ShadcnButton
                                        type="button"
                                        variant="ghost"
                                        size="icon-sm"
                                        className={discussionSearchOpen ? 'bg-muted text-foreground' : 'text-muted-foreground'}
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
                                            className={`gap-1.5 ${(selectedProject?.current_user_vote || '') === 'up' ? 'border-green-600/30 bg-green-600/10 text-green-600 hover:bg-green-600/10 hover:text-green-600' : ''}`}
                                            onClick={() => handleVoteChange(selectedProject.db_id, (selectedProject?.current_user_vote || '') === 'up' ? '' : 'up')}
                                        >
                                            <ThumbsUp className="size-4" />
                                            <span>Upvote</span>
                                            <strong>{selectedProject?.vote_summary?.up || 0}</strong>
                                        </ShadcnButton>
                                        <ShadcnButton
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            className={`gap-1.5 ${(selectedProject?.current_user_vote || '') === 'down' ? 'border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/10 hover:text-destructive' : ''}`}
                                            onClick={() => handleVoteChange(selectedProject.db_id, (selectedProject?.current_user_vote || '') === 'down' ? '' : 'down')}
                                        >
                                            <ThumbsDown className="size-4" />
                                            <span>Downvote</span>
                                            <strong>{selectedProject?.vote_summary?.down || 0}</strong>
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
                                            const assigned = (selectedProject?.assigned_user_ids || []).includes(user.id);
                                            return (
                                                <button
                                                    key={user.id}
                                                    type="button"
                                                    onClick={() => toggleAssignment(user.id)}
                                                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${assigned ? 'border-primary/30 bg-primary/5 text-primary' : 'border-border bg-card text-muted-foreground hover:bg-muted'}`}
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
                                            onClick={handleDeadlineSave}
                                            disabled={!canEditDeadline || savingDeadline}
                                        >
                                            {savingDeadline ? 'Saving...' : 'Save deadline'}
                                        </ShadcnButton>
                                    </div>
                                    {selectedProject?.deadline_updated_by || selectedProject?.deadline_updated_at ? (
                                        <p className="text-xs text-muted-foreground">
                                            {selectedProject?.deadline_updated_by ? `Updated by ${selectedProject.deadline_updated_by}` : 'Deadline updated'}
                                            {selectedProject?.deadline_updated_at ? ` on ${formatDisplayDate(selectedProject.deadline_updated_at)}` : ''}
                                        </p>
                                    ) : null}
                                </div>
                            </div>

                            <div className="min-h-0 flex-1" onClick={handleAttachmentClick}>
                                <ProjectInspector
                                    project={selectedProject}
                                    comments={filteredComments}
                                    commentsLoading={commentsLoading}
                                    authUser={authUser}
                                    availableUsers={availableUsers}
                                    canManageDecision={canManageDecision}
                                    onDecisionChange={(nextDecision) => handleDecisionChange(selectedProjectIndex, nextDecision)}
                                    onOpenFullPage={() => { window.location.hash = buildTenderHash(selectedProject.db_id); }}
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
                            />

                            {previewAttachment ? (
                                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setPreviewAttachment(null)}>
                                    <div className={`flex w-full flex-col overflow-hidden rounded-xl bg-card shadow-xl ${previewAttachment.kind === 'pdf' ? 'h-full max-w-4xl' : 'max-w-2xl'}`} onClick={(e) => e.stopPropagation()}>
                                        <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
                                            <span className="min-w-0 truncate text-sm font-medium text-foreground">{previewAttachment.originalName || 'Attachment'}</span>
                                            <div className="flex shrink-0 items-center gap-1">
                                                <a
                                                    className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                                                    href={previewAttachment.url}
                                                    download={previewAttachment.originalName || 'attachment'}
                                                    aria-label="Download attachment"
                                                    title="Download"
                                                >
                                                    ↓
                                                </a>
                                                <button
                                                    type="button"
                                                    className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
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
