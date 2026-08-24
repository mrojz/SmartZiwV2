import { useState, useEffect, useMemo, useRef } from 'react';
import { Button as ShadcnButton } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Avatar as ShadcnAvatar, AvatarFallback } from '@/components/ui/avatar';
import { Paperclip, Send } from 'lucide-react';

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

export default function CommentComposer({
    entity,
    body,
    setBody,
    onSubmit,
    currentUser,
    availableUsers,
    apiFetch,
    className = '',
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
        // The Smart-Ziw bot is mentionable like any user; mentioning it triggers the agent.
        const bot = { id: 'bot:smart-ziw', name: 'Smart-Ziw Bot', email: '', mentionLabel: '@smartziw' };
        const botMatches = !query || 'smart ziw bot'.includes(query);
        const users = (mentionUsers || []).filter((user) => user.id !== currentUser?.id);
        return (botMatches ? [bot] : [])
            .concat(users.filter((user) => {
                if (!query) return true;
                return `${user.name || ''} ${user.email || ''}`.toLowerCase().includes(query);
            }))
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
        const label = user?.mentionLabel || user?.name || user?.email || '';
        if (!label || mentionState.start < 0) return;
        const start = mentionState.start;
        const end = mentionState.end < 0 ? body.length : mentionState.end;
        const nextValue = `${body.slice(0, start)}@${label} ${body.slice(end)}`;
        setBody(nextValue);
        setSelectedMentions((prev) => {
            const next = prev.filter((item) => item.userId !== user.id);
            next.push({ userId: user.id, name: user.name, email: user.email, mentionLabel: label });
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
        const mentions = selectedMentions.filter((mention) => body.includes(`@${mention.mentionLabel || mention.name || mention.email}`));
        return onSubmit(pendingFiles, mentions, () => {
            setPendingFiles([]);
            setSelectedMentions([]);
            setMentionState({ open: false, query: '', start: -1, end: -1, index: 0 });
        });
    };

    return (
        <div className={`border-t p-4 tender-comment-composer ${className}`}>
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
                    <div className="absolute bottom-full left-0 right-0 z-30 mb-2 flex max-h-56 flex-col gap-1 overflow-y-auto rounded-lg border bg-popover p-1 shadow-lg">
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
