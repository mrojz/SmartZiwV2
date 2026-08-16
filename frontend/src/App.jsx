
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import ProjectTable from './components/ProjectTable';
import DemoWalkthrough from './components/DemoWalkthrough';
import SyncPanel from './components/SyncPanel';
import ConfigPanel from './components/ConfigPanel';
import SchedulePanel from './components/SchedulePanel';
import { X, Edit01, Key01, UserX01, UserCheck01, SearchLg } from '@untitledui/icons';
import { Button } from '@/components/base/buttons/button';
import { Input } from '@/components/base/input/input';
import { InputBase } from '@/components/base/input/input';
import { Toggle } from '@/components/base/toggle/toggle';
import { Select } from '@/components/base/select/select';
import { TextArea } from '@/components/base/textarea/textarea';
import { ModalOverlay, Modal, Dialog } from '@/components/application/modals/modal';
import { Table } from '@/components/application/table/table';
import { Dropdown } from '@/components/base/dropdown/dropdown';
import Sidebar, { Avatar, NAV_GROUPS } from './components/Sidebar';
import AnalyticsPage from './components/AnalyticsPage';
import { Search, Bell, RefreshCw, User, Shield, Settings, CalendarClock, LogOut, Mail, Lock, XIcon, Paperclip, Send } from 'lucide-react';
import { SidebarProvider } from '@/components/ui/sidebar';
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button as ShadcnButton } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input as ShadcnInput } from '@/components/ui/input';
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { Avatar as ShadcnAvatar, AvatarFallback } from '@/components/ui/avatar';

const API = '/api';
const APP_RELEASE_VERSION = '1.6';
const RELEASE_NOTES_STORAGE_KEY = 'pw_release_notes_seen';
const DEFAULT_RELEASE_NOTES = [
    {
        version: '1.6',
        title: 'Simplified LLM Provider configuration',
        summary: 'Choose between environment or LightLLM configuration with a click, and discover available models automatically from your LightLLM server.',
        items: [
            'LLM provider settings now use a simple Environment / LightLLM choice.',
            'Models are discovered automatically from your LightLLM server — no need to know model names.',
            'The environment configuration now shows which model and API key are in use.',
        ],
    },
    {
        version: '1.5',
        title: 'Smart-Ziw chat, human-only next actions, and configurable LLM provider',
        summary: 'Tag @SmartZiw in a project comment to ask the agent questions, next actions now list only tasks a human must do, and the admin can point Smart-Ziw at any OpenAI-compatible LLM (LightLLM).',
        items: [
            'Added @SmartZiw mention support: ask the agent directly in the project discussion and it replies as a comment.',
            'Next actions now contain only human-only obligations; LLM-automatable tasks are filtered out.',
            'Added an admin LLM provider setting (auto / DeepSeek / LightLLM) with LightLLM base URL, model, and API key.',
        ],
    },
    {
        version: '1.4',
        title: 'Smart-Ziw web research',
        summary: 'Smart-Ziw now researches the web with Firecrawl, downloads tender documents, and produces cited GO/NO-GO assessments.',
        items: [
            'Added Firecrawl-powered web research with unlimited page and document discovery.',
            'Tender documents are downloaded and converted to readable markdown (markitdown).',
            'Smart-Ziw reports now include a GO/NO-GO/MONITOR recommendation with numbered source citations.',
            'Added admin settings for the Firecrawl API key, research toggle, and time limit.',
        ],
    },
    {
        version: '1.3',
        title: 'Smart-Ziw Agent replaces Deep Dive',
        summary: 'Replaced Deep Dive research with Smart-Ziw project mirror generation and added configurable GitLab push.',
        items: [
            'Replaced Deep Dive Search with Smart-Ziw Agent in the project inspector.',
            'Smart-Ziw Agent generates dated tender folders with markdown mirrors.',
            'Added admin settings for local repo path and optional GitLab push.',
            'Removed the legacy Deep Dive feature and API.',
        ],
    },
    {
        version: '1.2',
        title: 'More sources and richer discussion previews',
        summary: 'Added new scraping sources and improved the in-app file experience in Discussion.',
        items: [
            'Added IsDB and BADEA as new scraping sources.',
            'Improved comments when sending images so image attachments display directly in the thread.',
            'PDF files now open directly inside the app instead of downloading automatically.',
        ],
    },
    {
        version: '1.1',
        title: 'Authentication and major UI refresh',
        summary: 'Introduced login plus broad UI improvements and bug-fix work across the product.',
        items: [
            'Added user login and protected access to the application.',
            'Delivered major UI updates across the dashboard and workflow surfaces.',
            'Included general bug fixes and UX improvements.',
        ],
    },
    {
        version: '1.0',
        title: 'Initial procurement intelligence release',
        summary: 'First production release of the scraping and review workflow.',
        items: [
            'Project scraping from IADB, Global Tenders, World Bank, GIZ, Development Aid, DGMarket, and Africa Gateway.',
            'Procurement Watch table and review workflow.',
            'Scheduled sync support.',
        ],
    },
];

function compareVersionStrings(a = '0', b = '0') {
    const left = String(a).replace(/^v/i, '').split('.').map((part) => Number(part) || 0);
    const right = String(b).replace(/^v/i, '').split('.').map((part) => Number(part) || 0);
    const length = Math.max(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
        const l = left[index] || 0;
        const r = right[index] || 0;
        if (l > r) return 1;
        if (l < r) return -1;
    }
    return 0;
}

function buildNotificationStreamUrl() {
    const token = localStorage.getItem('pw_access_token');
    const params = new URLSearchParams();
    if (token) params.set('access_token', token);
    const query = params.toString();
    return query ? `${API}/notifications/stream?${query}` : `${API}/notifications/stream`;
}

const ADMIN_ROUTES = ['admin', 'users', 'smart-ziw', 'llm-config'];

const DEMO_STEPS = [
    { target: '.usb-root', title: 'Filter bar', body: 'Narrow the list by source, region, deadline, or scrape date. The list defaults to the last 7 days.' },
    { target: '.app-table tbody tr:first-child', title: 'Tender rows', body: 'Each row is a tender. Open it to see the full analysis, discussion, and next actions.' },
    { target: '.project-inspector-actions button', title: 'Smart-Ziw agent', body: 'Ask the agent in a tender\'s discussion with @SmartZiw, or run the full analysis from here.' },
];

function normalizeRoute(rawRoute = '') {
    const route = String(rawRoute || '').replace(/^#/, '').replace(/^\//, '');
    if (route === 'comments' || route.startsWith('tenders/')) return 'dashboard';
    return route || 'dashboard';
}

function getTenderIdFromHash(rawHash = '') {
    const hash = String(rawHash || '').replace(/^#/, '').replace(/^\//, '');
    const match = hash.match(/^tenders\/([^/?#]+)/);
    return match ? decodeURIComponent(match[1]) : '';
}

function buildTenderHash(projectDbId = '') {
    return projectDbId ? `#/tenders/${encodeURIComponent(projectDbId)}` : '#dashboard';
}

function buildTenderShareUrl(projectDbId = '') {
    if (!projectDbId || typeof window === 'undefined') return '';
    return `${window.location.origin}${window.location.pathname}${window.location.search}${buildTenderHash(projectDbId)}`;
}

function formatActorList(names = []) {
    const cleaned = [...new Set((names || []).map((name) => String(name || '').trim()).filter(Boolean))];
    if (!cleaned.length) return 'Someone';
    if (cleaned.length === 1) return cleaned[0];
    if (cleaned.length === 2) return `${cleaned[0]} and ${cleaned[1]}`;
    return `${cleaned.slice(0, -1).join(', ')} and ${cleaned[cleaned.length - 1]}`;
}

function buildGroupedNotifications(notifications = [], projects = []) {
    const projectIdByDbId = new Map(
        (projects || [])
            .filter((item) => item?.db_id)
            .map((item) => [item.db_id, item.project_id || item.entityId || item.project_name || ''])
    );
    const groups = new Map();
    for (const item of notifications || []) {
        const projectKey = item.projectDbId || item.entityId || item.id;
        const groupKey = `${item.type || 'notification'}::${projectKey}`;
        const existing = groups.get(groupKey);
        if (!existing) {
            groups.set(groupKey, {
                id: groupKey,
                type: item.type || 'notification',
                projectDbId: item.projectDbId || '',
                entityId: item.entityId || '',
                projectLabel: projectIdByDbId.get(item.projectDbId) || item.entityId || 'unknown',
                actorNames: item.actorName ? [item.actorName] : [],
                createdAt: item.createdAt,
                read: Boolean(item.read),
                viewed: Boolean(item.viewed),
                notificationIds: [item.id],
                items: [item],
            });
            continue;
        }
        existing.notificationIds.push(item.id);
        existing.items.push(item);
        if (item.actorName) existing.actorNames.push(item.actorName);
        if (!item.read) existing.read = false;
        if (!item.viewed) existing.viewed = false;
        if ((item.createdAt || '') > (existing.createdAt || '')) existing.createdAt = item.createdAt;
    }

    const messageForGroup = (group) => {
        const actors = formatActorList(group.actorNames);
        const projectLabel = group.projectLabel || group.entityId || 'unknown';
        if (group.type === 'mention') return `${actors} tagged you in project ${projectLabel}`;
        if (group.type === 'assignment') return `${actors} assigned you to project ${projectLabel}`;
        if (group.type === 'comment') return `${actors} commented on project ${projectLabel}`;
        return `${actors} updated project ${projectLabel}`;
    };

    return [...groups.values()]
        .map((group) => ({
            ...group,
            actorNames: [...new Set(group.actorNames)],
            message: messageForGroup(group),
        }))
        .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

function initials(name = '', email = '') {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    if (parts.length === 1) return parts[0][0].toUpperCase();
    return (email[0] || '?').toUpperCase();
}

const COMMENT_IMAGE_UPLOAD_TARGET_BYTES = 1.5 * 1024 * 1024;
const COMMENT_IMAGE_UPLOAD_RETRY_BYTES = 900 * 1024;
const COMMENT_IMAGE_MAX_DIMENSION = 1800;
const COMMENT_FILE_UPLOAD_LIMIT_MB = 50;

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

function getProjectSeedKey(project = {}) {
    return [
        project?.source || '',
        project?.project_id || '',
        project?.project_url || '',
        project?.document_url || '',
        project?.project_name || '',
        project?.project_description || '',
        project?.project_sponsor || '',
        project?.project_end_date || '',
    ].join('::');
}

function attachProjectRowIds(items = []) {
    const seen = new Map();
    return items.map((project) => {
        if (project?.__rowId) return project;
        const seed = getProjectSeedKey(project);
        const occurrence = (seen.get(seed) || 0) + 1;
        seen.set(seed, occurrence);
        return {
            ...project,
            __rowId: `${seed}__${occurrence}`,
        };
    });
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

function formatAdminDateTime(value) {
    if (!value) return 'Never';
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return String(value);
    return new Intl.DateTimeFormat('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    }).format(dt).replace(',', ' ·');
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

function setModalScrollLock(locked) {
    if (typeof document === 'undefined') return;
    const body = document.body;
    const html = document.documentElement;
    const current = Number(body.dataset.modalLockCount || '0');
    const next = locked ? current + 1 : Math.max(0, current - 1);
    body.dataset.modalLockCount = String(next);
    const shouldLock = next > 0;
    body.classList.toggle('modal-scroll-locked', shouldLock);
    html.classList.toggle('modal-scroll-locked', shouldLock);
}


function LoginPage({ onLogin, error, bootstrap }) {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');

    return (
        <div className="flex min-h-screen items-center justify-center p-6">
            <Card className="w-full max-w-md">
                <CardContent className="flex flex-col gap-6 p-8">
                    <div className="flex justify-center">
                        <img src="/forvis-mazars-logo.svg" alt="Forvis Mazars" className="h-10" />
                    </div>
                    <div className="text-center">
                        <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
                        <p className="mt-1 text-sm text-muted-foreground">Sign in to Procurement Watch</p>
                    </div>
                    <form
                        className="flex flex-col gap-4"
                        onSubmit={(e) => {
                            e.preventDefault();
                            onLogin(email, password);
                        }}
                    >
                        {!bootstrap?.hasAdmin ? (
                            <p className="text-sm text-destructive">No admin user exists. Set ADMIN_EMAIL and ADMIN_PASSWORD, then restart backend.</p>
                        ) : null}
                        <div className="flex flex-col gap-2">
                            <Label htmlFor="login-email">Email</Label>
                            <div className="relative">
                                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                <ShadcnInput
                                    id="login-email"
                                    name="email"
                                    type="email"
                                    placeholder="your@email.com"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    required
                                    autoComplete="email"
                                    className="pl-10"
                                />
                            </div>
                        </div>
                        <div className="flex flex-col gap-2">
                            <Label htmlFor="login-password">Password</Label>
                            <div className="relative">
                                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                <ShadcnInput
                                    id="login-password"
                                    name="password"
                                    type="password"
                                    placeholder="••••••••"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    required
                                    autoComplete="current-password"
                                    className="pl-10"
                                />
                            </div>
                        </div>
                        {error ? <p className="text-sm text-destructive">{error}</p> : null}
                        <ShadcnButton type="submit" className="w-full">Sign In</ShadcnButton>
                    </form>
                </CardContent>
            </Card>
        </div>
    );
}

function ForcePasswordPage({ onSubmit, error }) {
    const [newPassword, setNewPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [showNewPassword, setShowNewPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const passwordMismatch = Boolean(confirm && newPassword !== confirm);
    const passwordStrength = useMemo(() => {
        const value = String(newPassword || '');
        if (!value) return { label: 'Use at least 8 characters.', tone: 'muted' };
        let score = 0;
        if (value.length >= 8) score += 1;
        if (/[A-Z]/.test(value) && /[a-z]/.test(value)) score += 1;
        if (/\d/.test(value) || /[^A-Za-z0-9]/.test(value)) score += 1;
        if (score <= 1) return { label: 'Password strength: weak', tone: 'weak' };
        if (score === 2) return { label: 'Password strength: medium', tone: 'medium' };
        return { label: 'Password strength: strong', tone: 'strong' };
    }, [newPassword]);
    const canSubmit = newPassword.length >= 8 && newPassword === confirm;

    const strengthClasses = {
        muted: 'text-muted-foreground',
        weak: 'text-destructive',
        medium: 'text-foreground',
        strong: 'text-green-700',
    };

    return (
        <div className="flex min-h-screen items-center justify-center p-6">
            <Card className="w-full max-w-md">
                <CardContent className="flex flex-col gap-6 p-8">
                    <div>
                        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Account security</span>
                        <h2 className="mt-1 text-2xl font-semibold tracking-tight">Change your password</h2>
                        <p className="mt-1 text-sm text-muted-foreground">For security reasons, you must set a new password before continuing.</p>
                    </div>
                    <form
                        className="flex flex-col gap-4"
                        onSubmit={(e) => {
                            e.preventDefault();
                            if (canSubmit) onSubmit(newPassword);
                        }}
                    >
                        <div className="flex flex-col gap-2">
                            <Label htmlFor="force-password-new">New password</Label>
                            <div className="relative">
                                <ShadcnInput
                                    id="force-password-new"
                                    name="newPassword"
                                    type={showNewPassword ? 'text' : 'password'}
                                    minLength={8}
                                    placeholder="Enter a new password"
                                    value={newPassword}
                                    onChange={(e) => setNewPassword(e.target.value)}
                                    autoComplete="new-password"
                                    required
                                    className="pr-16"
                                />
                                <button
                                    type="button"
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-sm font-medium text-muted-foreground hover:text-foreground"
                                    onClick={() => setShowNewPassword((value) => !value)}
                                    aria-label={showNewPassword ? 'Hide new password' : 'Show new password'}
                                >
                                    {showNewPassword ? 'Hide' : 'Show'}
                                </button>
                            </div>
                            <span className={`text-xs ${strengthClasses[passwordStrength.tone]}`}>{passwordStrength.label}</span>
                        </div>

                        <div className="flex flex-col gap-2">
                            <Label htmlFor="force-password-confirm">Confirm password</Label>
                            <div className="relative">
                                <ShadcnInput
                                    id="force-password-confirm"
                                    name="confirmPassword"
                                    type={showConfirmPassword ? 'text' : 'password'}
                                    minLength={8}
                                    placeholder="Re-enter the new password"
                                    value={confirm}
                                    onChange={(e) => setConfirm(e.target.value)}
                                    autoComplete="new-password"
                                    required
                                    className="pr-16"
                                />
                                <button
                                    type="button"
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-sm font-medium text-muted-foreground hover:text-foreground"
                                    onClick={() => setShowConfirmPassword((value) => !value)}
                                    aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
                                >
                                    {showConfirmPassword ? 'Hide' : 'Show'}
                                </button>
                            </div>
                            {passwordMismatch ? <p className="text-sm text-destructive">Passwords do not match.</p> : <span className="text-xs text-muted-foreground">Use the same password in both fields.</span>}
                        </div>

                        {error ? <p className="text-sm text-destructive">{error}</p> : null}

                        <ShadcnButton type="submit" className="w-full" disabled={!canSubmit}>
                            Update password
                        </ShadcnButton>
                    </form>
                </CardContent>
            </Card>
        </div>
    );
}

const RELEASE_ITEM_GROUPS = [
    { key: 'new', label: 'New' },
    { key: 'improved', label: 'Improved' },
    { key: 'fixed', label: 'Fixed' },
];

function releaseItemCategory(item) {
    const text = String(item || '').trim();
    if (/^added\b/i.test(text)) return 'new';
    if (/\bfix(es|ed)?\b/i.test(text)) return 'fixed';
    return 'improved';
}

function groupReleaseItems(items) {
    const buckets = { new: [], improved: [], fixed: [] };
    (items || []).forEach((item) => buckets[releaseItemCategory(item)].push(item));
    return RELEASE_ITEM_GROUPS
        .filter((group) => buckets[group.key].length)
        .map((group) => ({ ...group, items: buckets[group.key] }));
}

function ReleaseChangelogCard({ note, isLatest = false, compact = false }) {
    const groups = groupReleaseItems(note.items);
    return (
        <article className={`release-card${isLatest ? ' is-latest' : ''}${compact ? ' is-compact' : ''}`}>
            <div className="release-card-badge-row">
                <span className="release-card-badge">v{note.version}</span>
                {isLatest ? <span className="release-card-tag">Latest</span> : null}
            </div>
            <h3 className="release-card-title">{note.title}</h3>
            <p className="release-card-summary">{note.summary}</p>
            <div className="release-card-groups">
                {groups.map((group) => (
                    <div key={group.key} className="release-card-group">
                        <h4 className="release-card-group-title">{group.label}</h4>
                        <ul className="release-card-list">
                            {group.items.map((item) => <li key={item} className="release-card-item">{item}</li>)}
                        </ul>
                    </div>
                ))}
            </div>
        </article>
    );
}

function ReleaseNotesModal({ open, releases, onClose, onOpenFull }) {
    useEffect(() => {
        if (!open) return undefined;
        setModalScrollLock(true);
        const onKeyDown = (event) => {
            if (event.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => {
            window.removeEventListener('keydown', onKeyDown);
            setModalScrollLock(false);
        };
    }, [open, onClose]);

    if (!open) return null;

    const latest = releases[0] || DEFAULT_RELEASE_NOTES[0];

    return (
        <div className="modal-overlay release-notes-overlay" onClick={onClose}>
            <div className="release-notes-modal" onClick={(event) => event.stopPropagation()}>
                <div className="release-notes-modal-header">
                    <div className="release-notes-modal-copy">
                        <span className="release-notes-eyebrow">App updated</span>
                        <h2>What&apos;s new in v{latest.version}</h2>
                        <p>{latest.summary}</p>
                    </div>
                    <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close release notes">
                        <X />
                    </button>
                </div>
                <div className="release-notes-modal-body">
                    {releases.map((note) => (
                        <ReleaseChangelogCard
                            key={note.version}
                            note={note}
                            isLatest={note.version === APP_RELEASE_VERSION}
                            compact
                        />
                    ))}
                </div>
                <div className="release-notes-modal-footer">
                    <button type="button" className="release-link-btn" onClick={onOpenFull}>
                        View full release notes
                    </button>
                    <button type="button" className="sync-btn release-primary-btn" onClick={onClose}>
                        Continue
                    </button>
                </div>
            </div>
        </div>
    );
}

function ReleaseNotesPage({ releases, onBack }) {
    return (
        <div className="release-notes-page">
            <div className="release-notes-page-header">
                <div>
                    <h1 className="layout-page-title">Release Notes</h1>
                    <p className="layout-page-subtitle">Track major platform updates and newly delivered capabilities.</p>
                </div>
                <button type="button" className="header-secondary-btn" onClick={onBack}>Back</button>
            </div>
            <div className="release-notes-timeline">
                {releases.map((note) => (
                    <ReleaseChangelogCard
                        key={note.version}
                        note={note}
                        isLatest={note.version === APP_RELEASE_VERSION}
                    />
                ))}
            </div>
        </div>
    );
}

function VoteUpIcon() {
    return (
        <svg viewBox="0 0 20 20" aria-hidden="true" className="vote-action-icon">
            <path d="M10 15.5V5.5M10 5.5l-4 4M10 5.5l4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

function VoteDownIcon() {
    return (
        <svg viewBox="0 0 20 20" aria-hidden="true" className="vote-action-icon">
            <path d="M10 4.5v10M10 14.5l-4-4M10 14.5l4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

function NotificationsPanel({ open, notifications, unreadCount, onClose, onOpenNotification, onMarkAllRead }) {
    useEffect(() => {
        if (!open) return undefined;
        setModalScrollLock(true);
        return () => setModalScrollLock(false);
    }, [open]);

    if (!open) return null;

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-card modal-card-sm notifications-panel" onClick={(event) => event.stopPropagation()}>
                <div className="modal-header">
                    <div>
                        <h2 className="modal-title">Notifications</h2>
                        <p className="panel-subtext">{unreadCount} unread</p>
                    </div>
                    <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close notifications"><X /></button>
                </div>
                <div className="modal-body notifications-panel-body">
                    {notifications.length ? notifications.map((item) => (
                        <button
                            key={item.id}
                            type="button"
                            className={`notification-row ${item.read ? '' : 'is-unread'} ${item.viewed ? '' : 'is-unviewed'}`}
                            onClick={() => onOpenNotification(item)}
                        >
                            <div className="notification-row-copy">
                                <strong>{item.message}</strong>
                                <span>{formatDisplayDate(item.createdAt)}</span>
                            </div>
                        </button>
                    )) : <p className="auth-muted">No notifications yet.</p>}
                </div>
                <div className="modal-footer">
                    <button type="button" className="profile-btn profile-btn-secondary" onClick={onClose}>Close</button>
                    <button type="button" className="profile-btn profile-btn-primary" onClick={onMarkAllRead} disabled={!unreadCount}>Mark all read</button>
                </div>
            </div>
        </div>
    );
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

function CommentsPanel({
    open,
    entity,
    project,
    projectRegion,
    comments,
    mine,
    setMine,
    body,
    setBody,
    onSubmit,
    onClose,
    currentUser,
    apiFetch,
    onDecisionChange,
    onDeadlineSave,
    availableUsers,
    onAssignmentsChange,
    onVoteChange,
    onSmartZiwSearch,
    shareUrl,
}) {
    const listRef = useRef(null);
    const fileInputRef = useRef(null);
    const textAreaRef = useRef(null);
    const [pendingFiles, setPendingFiles] = useState([]);
    const [uploading, setUploading] = useState(false);
    const [composerFocused, setComposerFocused] = useState(false);
    const [searchOpen, setSearchOpen] = useState(false);
    const [search, setSearch] = useState('');
    const [deadlineInput, setDeadlineInput] = useState('');
    const [savingDeadline, setSavingDeadline] = useState(false);
    const [previewAttachment, setPreviewAttachment] = useState(null);
    const [selectedMentions, setSelectedMentions] = useState([]);
    const [mentionState, setMentionState] = useState({ open: false, query: '', start: -1, end: -1, index: 0 });
    const [savingAssignments, setSavingAssignments] = useState(false);
    const [runningSmartZiw, setRunningSmartZiw] = useState(false);
    const [mentionUsers, setMentionUsers] = useState([]);
    const [shareCopied, setShareCopied] = useState(false);

    useEffect(() => {
        const onKey = (e) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, onClose]);

    useEffect(() => {
        if (listRef.current) {
            listRef.current.scrollTop = listRef.current.scrollHeight;
        }
    }, [comments]);

    useEffect(() => {
        if (open) {
            setPendingFiles([]);
            setComposerFocused(false);
            setSearch('');
            setSearchOpen(false);
            setDeadlineInput(toInputDate(project?.manual_deadline));
            setPreviewAttachment(null);
            setSelectedMentions([]);
            setMentionState({ open: false, query: '', start: -1, end: -1, index: 0 });
            setRunningSmartZiw(false);
            setShareCopied(false);
        }
    }, [open, entity?.id, project?.manual_deadline]);

    useEffect(() => {
        if (!open) return;
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
    }, [open, availableUsers, apiFetch]);

    useEffect(() => {
        const el = textAreaRef.current;
        if (!el) return;
        el.style.height = '42px';
        const nextHeight = Math.min(Math.max(el.scrollHeight, 42), 132);
        el.style.height = `${nextHeight}px`;
        el.style.overflowY = el.scrollHeight > 132 ? 'auto' : 'hidden';
    }, [body]);

    const normalizedComments = useMemo(
        () => comments.map(normalizeComment),
        [comments],
    );

    const canEditDeadline = currentUser?.role === 'admin' || currentUser?.role === 'manager';
    const canManageDecision = currentUser?.role === 'manager';
    const assignedUserIds = project?.assigned_user_ids || [];
    const assignedUsers = project?.assigned_users || [];
    const voteSummary = project?.vote_summary || { up: 0, down: 0 };
    const currentUserVote = project?.current_user_vote || '';
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

    if (!open) return null;

    const keywords = (project?.matched_keywords || '')
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean);

    const currentUserName = currentUser?.name || '';
    const projectTitle = project?.project_name || project?.project_description || 'No project selected';
    const projectDescription = project?.project_description && project?.project_description !== projectTitle
        ? project.project_description
        : '';
    const projectDecision = project?.decision || '';
    const projectVerified = project?.ai_verified === 'Yes';
    const effectiveDeadline = project?.effective_deadline || project?.manual_deadline || project?.scraped_deadline || project?.project_end_date || '';

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

    const handleSubmit = () => {
        const mentions = selectedMentions.filter((mention) => body.includes(`@${mention.name || mention.email}`));
        return onSubmit(pendingFiles, mentions, () => {
            setPendingFiles([]);
            setSelectedMentions([]);
            setMentionState({ open: false, query: '', start: -1, end: -1, index: 0 });
        });
    };

    const handleDeadlineSave = async () => {
        if (!canEditDeadline) return;
        setSavingDeadline(true);
        try {
            await onDeadlineSave(deadlineInput || null);
        } finally {
            setSavingDeadline(false);
        }
    };

    const handleSmartZiwSearch = async () => {
        if (!project?.db_id || runningSmartZiw) return;
        setRunningSmartZiw(true);
        try {
            await onSmartZiwSearch?.(project.db_id);
        } catch (error) {
            window.alert(error?.message || 'Failed to start Smart-Ziw Agent');
        } finally {
            setRunningSmartZiw(false);
        }
    };

    const handleCopyShareUrl = async () => {
        if (!shareUrl) return;
        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(shareUrl);
            } else {
                const tempInput = document.createElement('input');
                tempInput.value = shareUrl;
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
            window.prompt('Copy tender link', shareUrl);
        }
    };

    const toggleAssignment = async (userId) => {
        if (!project?.db_id) return;
        const next = assignedUserIds.includes(userId)
            ? assignedUserIds.filter((item) => item !== userId)
            : [...assignedUserIds, userId];
        setSavingAssignments(true);
        try {
            await onAssignmentsChange(project.db_id, next);
        } finally {
            setSavingAssignments(false);
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

    const filteredComments = search
        ? normalizedComments.filter((c) => {
            const q = search.toLowerCase();
            if ((c.body || '').toLowerCase().includes(q)) return true;
            return (c.attachments || []).some((a) => (a.originalName || '').toLowerCase().includes(q));
        })
        : normalizedComments;

    return (
        <>
        <Sheet open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
            <SheetContent side="right" showCloseButton={false} className="w-full gap-0 p-0 sm:max-w-[480px]">
                <SheetHeader className="flex flex-row items-start justify-between gap-4 border-b p-5">
                    <div className="min-w-0">
                        <SheetDescription className="text-xs font-medium uppercase tracking-wide">Project inspector</SheetDescription>
                        <SheetTitle className="mt-1 text-lg leading-snug">{projectTitle}</SheetTitle>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                        <ShadcnButton
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={handleCopyShareUrl}
                            disabled={!shareUrl}
                        >
                            {shareCopied ? 'Copied' : 'Copy link'}
                        </ShadcnButton>
                        <SheetClose asChild>
                            <ShadcnButton variant="ghost" size="icon-sm" aria-label="Close project inspector">
                                <XIcon />
                            </ShadcnButton>
                        </SheetClose>
                    </div>
                </SheetHeader>

                <ScrollArea className="min-h-0 flex-1">
                    <div className="flex flex-col gap-4 p-5">
                    <section className="flex flex-col gap-4 rounded-lg border bg-card p-4">
                        <div className="flex flex-wrap items-center gap-2">
                            <Badge className={projectDecision === 'Go' ? 'bg-green-700 text-white' : projectDecision === 'No Go' ? 'bg-red-700 text-white' : 'bg-muted text-muted-foreground'}>
                                {projectDecision || 'Pending'}
                            </Badge>
                            <Badge className={projectVerified ? 'bg-green-700 text-white' : 'bg-muted text-muted-foreground'}>
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

                        <div className="grid gap-4 sm:grid-cols-2">
                            <div className="flex flex-col gap-3">
                                <div>
                                    <h3 className="text-sm font-semibold text-foreground">Team signal</h3>
                                    <p className="mt-0.5 text-xs text-muted-foreground">Upvote or downvote the tender without changing the formal decision.</p>
                                </div>
                                <div className="flex gap-2">
                                    <ShadcnButton
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className={`gap-1.5 ${currentUserVote === 'up' ? 'border-green-600 bg-green-50 text-green-700 hover:bg-green-50 hover:text-green-700' : ''}`}
                                        onClick={(event) => {
                                            event.preventDefault();
                                            event.stopPropagation();
                                            onVoteChange?.(project?.db_id, currentUserVote === 'up' ? '' : 'up');
                                        }}
                                    >
                                        <VoteUpIcon />
                                        <span>Upvote</span>
                                        <strong>{voteSummary.up || 0}</strong>
                                    </ShadcnButton>
                                    <ShadcnButton
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className={`gap-1.5 ${currentUserVote === 'down' ? 'border-red-600 bg-red-50 text-red-700 hover:bg-red-50 hover:text-red-700' : ''}`}
                                        onClick={(event) => {
                                            event.preventDefault();
                                            event.stopPropagation();
                                            onVoteChange?.(project?.db_id, currentUserVote === 'down' ? '' : 'down');
                                        }}
                                    >
                                        <VoteDownIcon />
                                        <span>Downvote</span>
                                        <strong>{voteSummary.down || 0}</strong>
                                    </ShadcnButton>
                                </div>
                            </div>

                            <div className="flex flex-col gap-3">
                                <div>
                                    <h3 className="text-sm font-semibold text-foreground">Working on this tender</h3>
                                    <p className="mt-0.5 text-xs text-muted-foreground">Assign teammates to coordinate review and follow-up.</p>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    {(availableUsers || []).map((user) => {
                                        const assigned = assignedUserIds.includes(user.id);
                                        return (
                                            <button
                                                key={user.id}
                                                type="button"
                                                disabled={savingAssignments}
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
                        </div>

                        <Separator />
                        {canManageDecision ? (
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
                                        className={projectDecision === 'Go' ? 'border-green-600 bg-green-50 text-green-700 hover:bg-green-50 hover:text-green-700' : ''}
                                        onClick={() => onDecisionChange(projectDecision === 'Go' ? '' : 'Go')}
                                    >
                                        Go
                                    </ShadcnButton>
                                    <ShadcnButton
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className={projectDecision === 'No Go' ? 'border-red-600 bg-red-50 text-red-700 hover:bg-red-50 hover:text-red-700' : ''}
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
                        ) : null}

                        <div className="grid grid-cols-2 gap-3">
                            <div className="flex flex-col gap-1 rounded-lg bg-muted p-3"><span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Project ID</span><strong className="text-sm font-medium text-foreground">{project?.project_id || '-'}</strong></div>
                            <div className="flex flex-col gap-1 rounded-lg bg-muted p-3"><span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Region</span><strong className="text-sm font-medium text-foreground">{projectRegion || '-'}</strong></div>
                            <div className="flex flex-col gap-1 rounded-lg bg-muted p-3"><span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Sponsor</span><strong className="text-sm font-medium text-foreground">{project?.project_sponsor || '-'}</strong></div>
                            <div className="flex flex-col gap-1 rounded-lg bg-muted p-3"><span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Start date</span><strong className="text-sm font-medium text-foreground">{formatDisplayDate(project?.project_start_date)}</strong></div>
                            <div className="flex flex-col gap-1 rounded-lg bg-muted p-3"><span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Deadline</span><strong className="text-sm font-medium text-foreground">{formatDisplayDate(effectiveDeadline)}</strong></div>
                            <div className="flex flex-col gap-1 rounded-lg bg-muted p-3"><span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Source</span><strong className="text-sm font-medium text-foreground">{project?.source || '-'}</strong></div>
                            <div className="flex flex-col gap-1 rounded-lg bg-muted p-3"><span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Deadline source</span><strong className="text-sm font-medium text-foreground">{project?.deadline_source || '-'}</strong></div>
                            <div className="flex flex-col gap-1 rounded-lg bg-muted p-3"><span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Scraped deadline</span><strong className="text-sm font-medium text-foreground">{formatDisplayDate(project?.scraped_deadline || project?.project_end_date)}</strong></div>
                            <div className="flex flex-col gap-1 rounded-lg bg-muted p-3"><span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Manual deadline</span><strong className="text-sm font-medium text-foreground">{formatDisplayDate(project?.manual_deadline)}</strong></div>
                        </div>

                        <div className="flex flex-col gap-2">
                            <h3 className="text-sm font-semibold text-foreground">Manual deadline</h3>
                            <p className="text-xs text-muted-foreground">{canEditDeadline ? 'Override the scraped deadline when analyst review requires a correction.' : 'Only admins and managers can edit the deadline.'}</p>
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
                            {project?.deadline_updated_by || project?.deadline_updated_at ? (
                                <p className="text-xs text-muted-foreground">
                                    {project?.deadline_updated_by ? `Updated by ${project.deadline_updated_by}` : 'Deadline updated'}
                                    {project?.deadline_updated_at ? ` on ${formatDisplayDate(project.deadline_updated_at)}` : ''}
                                </p>
                            ) : null}
                        </div>

                        <div className="flex flex-col gap-3">
                            <h3 className="text-sm font-semibold text-foreground">Links</h3>
                            <div className="flex flex-col gap-2">
                                {project?.project_url ? <a href={project.project_url} target="_blank" rel="noreferrer" className="flex min-h-9 items-center rounded-lg bg-muted px-3 text-sm font-medium text-foreground hover:text-primary">Open source listing</a> : <span className="flex min-h-9 items-center rounded-lg bg-muted px-3 text-sm text-muted-foreground">No project link</span>}
                                {project?.document_url ? <a href={project.document_url} target="_blank" rel="noreferrer" className="flex min-h-9 items-center rounded-lg bg-muted px-3 text-sm font-medium text-foreground hover:text-primary">Open document</a> : <span className="flex min-h-9 items-center rounded-lg bg-muted px-3 text-sm text-muted-foreground">No document link</span>}
                            </div>
                            <Card>
                                <CardHeader className="px-4 pb-2 pt-4">
                                    <CardTitle className="text-sm font-semibold">Smart-Ziw Agent</CardTitle>
                                </CardHeader>
                                <CardContent className="flex flex-col items-start gap-2.5 px-4 pb-4">
                                    <div className="project-inspector-actions">
                                        <ShadcnButton
                                            type="button"
                                            onClick={handleSmartZiwSearch}
                                            disabled={!project?.db_id || runningSmartZiw || project?.smart_ziw_status === 'queued' || project?.smart_ziw_status === 'running'}
                                        >
                                            {runningSmartZiw || project?.smart_ziw_status === 'queued' || project?.smart_ziw_status === 'running' ? 'Generating...' : 'Smart-Ziw Agent'}
                                        </ShadcnButton>
                                        {project?.smart_ziw_status ? (
                                            <span className={`text-xs ${project?.smart_ziw_status === 'error' ? 'text-destructive' : project.smart_ziw_status === 'completed' ? 'text-green-600' : project.smart_ziw_status === 'queued' || project.smart_ziw_status === 'running' ? 'text-blue-600' : 'text-muted-foreground'}`}>
                                                {project?.smart_ziw_status === 'error' && project?.smart_ziw_error
                                                    ? `Last run failed: ${project.smart_ziw_error}`
                                                    : `Smart-Ziw status: ${project.smart_ziw_status}`}
                                            </span>
                                        ) : null}
                                    </div>
                                </CardContent>
                            </Card>
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

                    <section className="flex flex-col gap-3">
                        <Separator />
                        <div className="flex items-center justify-between gap-2">
                            <div className="flex items-baseline gap-2">
                                <h3 className="text-sm font-semibold text-foreground">Discussion</h3>
                                <span className="text-xs text-muted-foreground">{comments.length} notes</span>
                            </div>
                            <ShadcnButton
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                className={searchOpen ? 'bg-muted text-foreground' : 'text-muted-foreground'}
                                aria-label={searchOpen ? 'Hide message search' : 'Search messages'}
                                onClick={() => {
                                    if (searchOpen && !search) {
                                        setSearchOpen(false);
                                        return;
                                    }
                                    setSearchOpen((prev) => !prev);
                                }}
                            >
                                <Search />
                            </ShadcnButton>
                        </div>
                        {searchOpen ? (
                            <div className="relative">
                                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                                <ShadcnInput
                                    type="text"
                                    name="discussionSearch"
                                    aria-label="Search discussion messages"
                                    placeholder="Search messages..."
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    className="h-9 pl-8"
                                />
                            </div>
                        ) : null}

                        <div className="flex flex-col gap-3 rounded-lg bg-muted/50 p-3" ref={listRef}>
                            {!entity?.id ? <p className="text-sm text-muted-foreground">No entity selected.</p> : null}
                            {entity?.id && filteredComments.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">{search ? 'No messages match your search.' : 'No discussion yet. Add the first analyst note.'}</p> : null}
                            {filteredComments.map((c) => {
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
                                                        <button
                                                            key={att.fileId}
                                                            type="button"
                                                            className="mt-1.5 block w-full overflow-hidden rounded-lg border border-black/10"
                                                            onClick={() => setPreviewAttachment({ ...att, kind: 'image' })}
                                                        >
                                                            <img
                                                                className="max-h-64 w-full object-cover"
                                                                src={att.url}
                                                                alt={att.originalName || 'attachment'}
                                                                loading="lazy"
                                                            />
                                                        </button>
                                                    ) : isPdfAttachment(att) ? (
                                                        <button
                                                            key={att.fileId}
                                                            type="button"
                                                            className="mt-1.5 flex w-full items-center gap-2 rounded-lg border border-black/10 bg-card px-3 py-2 text-left"
                                                            onClick={() => setPreviewAttachment({ ...att, kind: 'pdf' })}
                                                        >
                                                            <Badge className="bg-red-600 text-white">PDF</Badge>
                                                            <span className="min-w-0 truncate text-sm font-medium text-foreground">{att.originalName}</span>
                                                        </button>
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

                        {pendingFiles.length > 0 ? (
                            <div className="flex flex-wrap gap-2 border-t pt-3">
                                {pendingFiles.map((f) => (
                                    <Badge key={f.fileId} variant="secondary" className="gap-1.5 pr-1 font-normal">
                                        {f.originalName}
                                        <button type="button" className="inline-flex size-4 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => removeFile(f.fileId)} title="Remove">x</button>
                                    </Badge>
                                ))}
                            </div>
                        ) : null}

                        <div className="relative flex items-end gap-2 border-t pt-3">
                            <input ref={fileInputRef} type="file" name="discussionAttachments" multiple style={{ display: 'none' }} onChange={handleFileChange} />
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
                                            className={`flex items-center justify-between gap-3 rounded-md px-2.5 py-2 text-left ${index === mentionState.index ? 'bg-muted' : 'bg-transparent hover:bg-muted'}`}
                                            onMouseDown={(event) => {
                                                event.preventDefault();
                                                insertMention(user);
                                            }}
                                        >
                                            <span className="text-sm font-semibold text-foreground">{user.name || user.email}</span>
                                            <span className="text-xs text-muted-foreground">{user.email}</span>
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
                    </section>
                    </div>
                </ScrollArea>
            </SheetContent>
        </Sheet>
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
                                className="h-full min-h-0 w-full rounded-lg border bg-white"
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
    );
}

function ProfilePage({ user, apiFetch, onUserUpdate }) {
    const parts = (user?.name || '').split(/\s+/).filter(Boolean);
    const [firstName, setFirstName] = useState(parts[0] || '');
    const [lastName, setLastName] = useState(parts.slice(1).join(' '));
    const [email, setEmail] = useState(user?.email || '');
    const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl || '');
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [msg, setMsg] = useState('');
    const [savingProfile, setSavingProfile] = useState(false);
    const [savingPassword, setSavingPassword] = useState(false);
    const name = `${firstName} ${lastName}`.trim() || 'User';
    const emailDomain = email?.split('@')[1] || 'No domain';
    const formatDate = (iso) => {
        if (!iso) return '—';
        const d = new Date(iso);
        return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    };
    const passwordMismatch = Boolean(newPassword && newPassword !== confirmPassword);

    const saveProfile = async () => {
        setSavingProfile(true);
        try {
            const res = await apiFetch('/api/auth/profile', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, email, avatarUrl }),
            });
            const data = await res.json();
            onUserUpdate(data.user);
            setMsg('Profile updated.');
        } finally {
            setSavingProfile(false);
        }
    };

    const savePassword = async () => {
        setSavingPassword(true);
        try {
            await apiFetch('/api/auth/change-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ currentPassword, newPassword }),
            });
            setCurrentPassword('');
            setNewPassword('');
            setConfirmPassword('');
            setMsg('Password updated.');
        } finally {
            setSavingPassword(false);
        }
    };

    return (
        <div className="layout-stack profile-page-v2">
            <PageHeader title="Profile settings" subtitle="Manage your personal information and account security." />

            <div className="profile-page-grid">
                <section className="panel-card profile-page-card">
                    <div className="profile-page-identity">
                        <div className="profile-page-avatar">
                            <Avatar user={user} size={76} />
                        </div>
                        <div className="profile-page-identity-copy">
                            <h2 className="profile-page-name">{name}</h2>
                            <div className="profile-page-secondary">
                                <span className={`profile-page-role-badge ${user?.role === 'admin' ? 'badge-admin' : user?.role === 'manager' ? 'badge-manager' : 'badge-user'}`}>
                                    {user?.role === 'admin' ? 'Admin' : user?.role === 'manager' ? 'Manager' : 'User'}
                                </span>
                                <span className={`profile-page-status ${user?.isActive !== false ? 'is-active' : 'is-inactive'}`}>
                                    <span className="profile-page-status-dot" />
                                    {user?.isActive !== false ? 'Active' : 'Inactive'}
                                </span>
                            </div>
                            <p className="profile-page-email">{email || 'No email address'}</p>
                        </div>
                    </div>

                    <dl className="profile-page-meta">
                        <div className="profile-page-meta-item">
                            <dt className="profile-page-meta-label">Joined</dt>
                            <dd className="profile-page-meta-value">{formatDate(user?.createdAt)}</dd>
                        </div>
                        <div className="profile-page-meta-item">
                            <dt className="profile-page-meta-label">Last updated</dt>
                            <dd className="profile-page-meta-value">{formatDate(user?.updatedAt)}</dd>
                        </div>
                        <div className="profile-page-meta-item">
                            <dt className="profile-page-meta-label">Email domain</dt>
                            <dd className="profile-page-meta-value">{emailDomain}</dd>
                        </div>
                    </dl>

                    <div className="profile-card-head">
                        <div>
                            <h3>Personal information</h3>
                            <p className="profile-card-description">Update your account details.</p>
                        </div>
                    </div>

                    <form
                        onSubmit={(event) => {
                            event.preventDefault();
                            saveProfile();
                        }}
                    >
                        <div className="profile-settings-grid">
                            <div className="auth-field">
                                <label className="auth-label" htmlFor="prof-firstname">First name</label>
                                <input id="prof-firstname" name="firstName" className="auth-input" placeholder="First name" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                            </div>
                            <div className="auth-field">
                                <label className="auth-label" htmlFor="prof-lastname">Last name</label>
                                <input id="prof-lastname" name="lastName" className="auth-input" placeholder="Last name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
                            </div>
                            <div className="auth-field profile-field-span-2">
                                <label className="auth-label" htmlFor="prof-email">Email</label>
                                <input id="prof-email" name="email" className="auth-input" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
                            </div>
                        </div>

                        <div className="profile-card-footer profile-card-footer-end">
                            <button type="submit" className="profile-btn profile-btn-primary" disabled={savingProfile}>{savingProfile ? 'Saving...' : 'Save changes'}</button>
                        </div>
                    </form>
                </section>

                    <section className="panel-card profile-page-card">
                        <div className="profile-card-head">
                            <div>
                                <h3>Preferences</h3>
                                <p className="profile-card-description">Choose how your public profile appears to others.</p>
                            </div>
                        </div>

                        <form
                            onSubmit={(event) => {
                                event.preventDefault();
                                saveProfile();
                            }}
                        >
                            <div className="profile-settings-grid">
                                <div className="auth-field profile-field-span-2">
                                    <label className="auth-label" htmlFor="prof-avatar">Profile photo URL</label>
                                    <input id="prof-avatar" name="avatarUrl" className="auth-input" placeholder="https://..." value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} />
                                    <span className="profile-field-hint">Use a direct image link to update the profile photo preview.</span>
                                </div>
                            </div>

                            <div className="profile-card-footer">
                                <button type="button" className="profile-btn profile-btn-secondary" onClick={() => setAvatarUrl('')}>Remove avatar</button>
                                <button type="submit" className="profile-btn profile-btn-primary" disabled={savingProfile}>{savingProfile ? 'Saving...' : 'Save changes'}</button>
                            </div>
                        </form>
                    </section>

                    <section className="panel-card profile-page-card">
                        <div className="profile-card-head">
                            <div>
                                <h3>Security</h3>
                                <p className="profile-card-description">Change your password and keep your account secure.</p>
                            </div>
                        </div>

                        <form
                            onSubmit={(event) => {
                                event.preventDefault();
                                if (savingPassword || !currentPassword || !newPassword || passwordMismatch) return;
                                savePassword();
                            }}
                        >
                            <div className="profile-password-stack">
                                <div className="auth-field">
                                    <label className="auth-label" htmlFor="prof-curpwd">Current password</label>
                                    <input id="prof-curpwd" name="currentPassword" className="auth-input" type="password" placeholder="Current password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
                                </div>
                                <div className="profile-password-grid">
                                    <div className="auth-field">
                                        <label className="auth-label" htmlFor="prof-newpwd">New password</label>
                                        <input id="prof-newpwd" name="newPassword" className="auth-input" type="password" placeholder="New password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
                                        <span className="profile-field-hint">Minimum 8 characters.</span>
                                    </div>
                                    <div className="auth-field">
                                        <label className="auth-label" htmlFor="prof-confirmpwd">Confirm new password</label>
                                        <input id="prof-confirmpwd" name="confirmPassword" className="auth-input" type="password" placeholder="Confirm new password" autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
                                        {passwordMismatch ? <span className="profile-pwd-mismatch">Passwords do not match.</span> : <span className="profile-field-hint">Re-enter the new password to confirm it.</span>}
                                    </div>
                                </div>
                            </div>

                            <div className="profile-card-footer profile-card-footer-end">
                                <button
                                    type="submit"
                                    className="profile-btn profile-btn-primary"
                                    disabled={savingPassword || !currentPassword || !newPassword || passwordMismatch}
                                >
                                    {savingPassword ? 'Saving...' : 'Update password'}
                                </button>
                            </div>
                        </form>
                    </section>
            </div>

            {msg ? <p className="profile-success-msg">{msg}</p> : null}
        </div>
    );
}

function UserDrawer({ open, mode, initialUser, onClose, onSave, saving }) {
    const [firstName, setFirstName] = useState('');
    const [lastName, setLastName] = useState('');
    const [email, setEmail] = useState('');
    const [role, setRole] = useState('user');
    const [avatarUrl, setAvatarUrl] = useState('');
    const [tempPassword, setTempPassword] = useState('');
    const [isActive, setIsActive] = useState(true);

    useEffect(() => {
        if (!open) return;
        const parts = (initialUser?.name || '').split(/\s+/).filter(Boolean);
        setFirstName(parts[0] || '');
        setLastName(parts.slice(1).join(' '));
        setEmail(initialUser?.email || '');
        setRole(initialUser?.role || 'user');
        setAvatarUrl(initialUser?.avatarUrl || '');
        setTempPassword('');
        setIsActive(initialUser?.isActive ?? true);
    }, [open, initialUser]);

    useEffect(() => {
        if (!open) return undefined;
        setModalScrollLock(true);
        return () => setModalScrollLock(false);
    }, [open]);

    if (!open) return null;

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-card" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h2 className="modal-title">{mode === 'create' ? 'Create User' : 'Edit User'}</h2>
                    <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close user drawer"><X /></button>
                </div>

                <form
                    onSubmit={(event) => {
                        event.preventDefault();
                        onSave({
                            name: `${firstName} ${lastName}`.trim(),
                            email: email.trim(),
                            role,
                            avatarUrl,
                            password: tempPassword,
                            isActive,
                        });
                    }}
                >
                    <div className="modal-body">
                        <div className="modal-grid-2col">
                            <div className="auth-field">
                                <label className="auth-label" htmlFor="ud-first">First name</label>
                                <input id="ud-first" name="firstName" className="auth-input" placeholder="First name" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                            </div>
                            <div className="auth-field">
                                <label className="auth-label" htmlFor="ud-last">Last name</label>
                                <input id="ud-last" name="lastName" className="auth-input" placeholder="Last name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
                            </div>
                        </div>

                        <div className="auth-field">
                            <label className="auth-label" htmlFor="ud-email">Email</label>
                            <input id="ud-email" name="email" className="auth-input" type="email" placeholder="user@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
                        </div>

                        <div className="modal-grid-2col">
                            <div className="auth-field">
                                <label className="auth-label" htmlFor="ud-role">Role</label>
                                <select id="ud-role" name="role" className="auth-input" value={role} onChange={(e) => setRole(e.target.value)}>
                                    <option value="user">User</option>
                                    <option value="manager">Manager</option>
                                    <option value="admin">Admin</option>
                                </select>
                            </div>
                            <div className="auth-field">
                                <label className="auth-label" htmlFor="ud-active">Status</label>
                                <label className="modal-toggle-row" htmlFor="ud-active">
                                    <input id="ud-active" name="isActive" type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
                                    <span className={`modal-toggle-label ${isActive ? 'active' : 'inactive'}`}>{isActive ? 'Active' : 'Disabled'}</span>
                                </label>
                            </div>
                        </div>

                        <div className="auth-field">
                            <label className="auth-label" htmlFor="ud-avatar">Avatar URL</label>
                            <input id="ud-avatar" name="avatarUrl" className="auth-input" placeholder="https://..." value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} />
                        </div>

                        {mode === 'create' && (
                            <div className="auth-field">
                                <label className="auth-label" htmlFor="ud-pwd">Temporary password <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(optional, auto-generated if empty)</span></label>
                                <input id="ud-pwd" name="temporaryPassword" className="auth-input" type="password" placeholder="Temporary password" autoComplete="new-password" value={tempPassword} onChange={(e) => setTempPassword(e.target.value)} />
                            </div>
                        )}
                    </div>

                    <div className="modal-footer">
                        <button type="button" className="profile-btn profile-btn-secondary" onClick={onClose}>Cancel</button>
                        <button
                            type="submit"
                            className="profile-btn profile-btn-primary"
                            disabled={saving || !email.trim()}
                        >
                            {saving ? 'Saving...' : mode === 'create' ? 'Create User' : 'Save Changes'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

function ResetPasswordModal({ open, user, onClose, onReset, saving, result }) {
    const [password, setPassword] = useState('');
    useEffect(() => { if (open) setPassword(''); }, [open]);
    useEffect(() => {
        if (!open) return undefined;
        setModalScrollLock(true);
        return () => setModalScrollLock(false);
    }, [open]);
    if (!open || !user) return null;

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-card modal-card-sm" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h2 className="modal-title">Reset Password</h2>
                    <button type="button" className="modal-close-btn" aria-label="Close dialog" onClick={onClose}><X /></button>
                </div>
                <form
                    onSubmit={(event) => {
                        event.preventDefault();
                        onReset(password || null);
                    }}
                >
                    <div className="modal-body">
                        <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.88rem' }}>
                            Reset password for <strong>{user.name || user.email}</strong>
                        </p>
                        <div className="auth-field">
                            <label className="auth-label" htmlFor="rp-pwd">New password <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(leave empty to auto-generate)</span></label>
                            <input id="rp-pwd" name="resetPassword" className="auth-input" type="password" placeholder="Auto-generated if empty" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
                        </div>
                        {result && <p className="profile-success-msg">{result}</p>}
                    </div>
                    <div className="modal-footer">
                        <button type="button" className="profile-btn profile-btn-secondary" onClick={onClose}>Cancel</button>
                        <button type="submit" className="profile-btn profile-btn-primary" disabled={saving}>
                            {saving ? 'Resetting...' : 'Reset Password'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

function AdminPage({ apiFetch, initialTab = 'users' }) {
    const [adminTab, setAdminTab] = useState(initialTab);
    const [users, setUsers] = useState([]);
    const [q, setQ] = useState('');
    const [roleFilter, setRoleFilter] = useState('all');
    const [statusFilter, setStatusFilter] = useState('all');
    const [message, setMessage] = useState('');
    const [drawer, setDrawer] = useState({ open: false, mode: 'create', user: null });
    const [savingDrawer, setSavingDrawer] = useState(false);
    const [refreshingUsers, setRefreshingUsers] = useState(false);
    const [resettingUserId, setResettingUserId] = useState('');
    const [togglingUserId, setTogglingUserId] = useState('');
    const [resetModal, setResetModal] = useState({ open: false, user: null });
    const [resetResult, setResetResult] = useState('');
    const [sortCol, setSortCol] = useState(null);
    const [sortDir, setSortDir] = useState('asc');
    const [page, setPage] = useState(0);
    const [rowsPerPage, setRowsPerPage] = useState(25);
    const [releaseNotes, setReleaseNotes] = useState([]);
    const [selectedReleaseVersion, setSelectedReleaseVersion] = useState('');
    const [releaseForm, setReleaseForm] = useState({ version: '', title: '', summary: '', itemsText: '' });
    const [savingReleaseNotes, setSavingReleaseNotes] = useState(false);
    const [smartZiwConfig, setSmartZiwConfig] = useState({
        smart_ziw_enabled: true,
        smart_ziw_repo_path: '/home/kali/Smart-Ziw',
        gitlab_push_enabled: false,
        gitlab_url: '',
        gitlab_token: '',
        gitlab_project_path: '',
        gitlab_branch: 'main',
        gitlab_author_name: 'Smart-Ziw Agent',
        gitlab_author_email: 'smart-ziw@localhost',
        firecrawl_api_key: '',
        firecrawl_base_url: 'https://api.firecrawl.dev',
        smart_ziw_research_enabled: true,
        smart_ziw_research_timeout_seconds: 900,
        smart_ziw_llm_provider: 'auto',
        lightllm_base_url: '',
        lightllm_api_key: '',
        lightllm_model: 'default',
        lightllm_provider: 'openai_compatible',
        llm_temperature: 0.1,
        llm_max_tokens: 4000,
    });
    const [savingSmartZiwConfig, setSavingSmartZiwConfig] = useState(false);
    const [testingLlm, setTestingLlm] = useState(false);
    const llmSource = smartZiwConfig.smart_ziw_llm_provider === 'lightllm' ? 'lightllm'
        : smartZiwConfig.smart_ziw_llm_provider === 'deepseek' ? 'environment'
        : (smartZiwConfig.lightllm_base_url.trim() ? 'lightllm' : 'environment');
    const llmDiscoverySeq = useRef(0);
    const [llmModels, setLlmModels] = useState({ status: 'idle', models: [], detail: null });
    const [llmModelsLoading, setLlmModelsLoading] = useState(false);
    const [llmEnvStatus, setLlmEnvStatus] = useState({ model: '', api_key_set: false });
    const handleSearchChange = useCallback((nextValue) => {
        if (typeof nextValue === 'string') {
            setQ(nextValue);
            return;
        }
        setQ(nextValue?.target?.value ?? '');
    }, []);

    const loadUsers = useCallback(async () => {
        setRefreshingUsers(true);
        try {
            const res = await apiFetch('/api/admin/users');
            setUsers(await res.json());
        } finally {
            setRefreshingUsers(false);
        }
    }, [apiFetch]);

    const loadReleaseNotes = useCallback(async () => {
        const res = await apiFetch('/api/admin/release-notes');
        const data = await res.json();
        const notes = Array.isArray(data?.notes) && data.notes.length ? data.notes : DEFAULT_RELEASE_NOTES;
        const sortedNotes = [...notes].sort((a, b) => compareVersionStrings(b.version, a.version));
        setReleaseNotes(sortedNotes);
        setSelectedReleaseVersion((current) => current || sortedNotes[0]?.version || '');
    }, [apiFetch]);

    const loadSmartZiwConfig = useCallback(async () => {
        const res = await apiFetch('/api/admin/smart-ziw-config');
        if (res.ok) {
            const data = await res.json();
            setSmartZiwConfig((prev) => ({ ...prev, ...data }));
        }
    }, [apiFetch]);

    const discoverLlmModels = useCallback(async (provider, baseUrl, apiKey) => {
        const seq = ++llmDiscoverySeq.current;
        setLlmModelsLoading(true);
        setLlmModels({ status: 'loading', models: [], detail: null });
        try {
            const res = await apiFetch('/api/admin/llm-models', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ provider, base_url: baseUrl, api_key: apiKey || '' }),
            });
            const data = res.ok ? await res.json() : { status: 'error', models: [], detail: null };
            if (seq === llmDiscoverySeq.current) {
                setLlmModels({ status: data?.status || 'error', models: Array.isArray(data?.models) ? data.models : [], detail: data?.detail || null });
            }
        } catch (error) {
            if (seq === llmDiscoverySeq.current) {
                setLlmModels({ status: 'error', models: [], detail: null });
            }
        } finally {
            if (seq === llmDiscoverySeq.current) setLlmModelsLoading(false);
        }
    }, [apiFetch]);

    useEffect(() => {
        if (adminTab !== 'llm') return;
        if (llmSource !== 'lightllm' || (smartZiwConfig.lightllm_provider !== 'openai_compatible' && smartZiwConfig.lightllm_provider !== 'anthropic_compatible') || !smartZiwConfig.lightllm_base_url.trim()) {
            setLlmModels({ status: 'idle', models: [], detail: null });
            setLlmModelsLoading(false);
            return;
        }
        discoverLlmModels(smartZiwConfig.lightllm_provider, smartZiwConfig.lightllm_base_url, smartZiwConfig.lightllm_api_key);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [adminTab, llmSource, smartZiwConfig.lightllm_provider]);

    useEffect(() => {
        if (adminTab !== 'llm') return;
        let cancelled = false;
        apiFetch('/api/admin/llm-env-status')
            .then((res) => (res.ok ? res.json() : null))
            .then((data) => {
                if (data && !cancelled) setLlmEnvStatus({ model: data.model || '', api_key_set: !!data.api_key_set });
            })
            .catch(() => {});
        return () => { cancelled = true; };
    }, [adminTab, apiFetch]);

    useEffect(() => {
        loadUsers();
    }, [loadUsers]);

    useEffect(() => {
        if (adminTab !== 'release-notes') return;
        loadReleaseNotes();
    }, [adminTab, loadReleaseNotes]);

    useEffect(() => {
        if (adminTab !== 'smart-ziw' && adminTab !== 'llm') return;
        loadSmartZiwConfig();
    }, [adminTab, loadSmartZiwConfig]);

    const saveSmartZiwConfig = async () => {
        setSavingSmartZiwConfig(true);
        try {
            const res = await apiFetch('/api/admin/smart-ziw-config', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(smartZiwConfig),
            });
            if (!res.ok) throw new Error('Failed to save');
            const data = await res.json();
            setSmartZiwConfig((prev) => ({ ...prev, ...data, gitlab_token: prev.gitlab_token, firecrawl_api_key: prev.firecrawl_api_key, lightllm_api_key: '' }));
            setMessage('Smart-Ziw config saved.');
        } catch (error) {
            setMessage(`Failed to save Smart-Ziw config: ${error?.message || 'unknown error'}`);
        } finally {
            setSavingSmartZiwConfig(false);
        }
    };

    const testAndSaveLlmConfig = async () => {
        setSavingSmartZiwConfig(true);
        setTestingLlm(true);
        try {
            setMessage('Testing LLM provider connection…');
            let testOk = false;
            let detail = '';
            try {
                const testRes = await apiFetch('/api/admin/llm-test', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(smartZiwConfig),
                });
                let testData = null;
                try {
                    testData = await testRes.json();
                } catch {
                    // Non-JSON test response.
                }
                testOk = testRes.ok && testData?.status === 'ok';
                detail = testData?.detail || `The provider test failed (HTTP ${testRes.status}).`;
            } catch (error) {
                detail = `The provider test could not run: ${error?.message || 'unknown error'}`;
            }
            if (!testOk) {
                const proceed = window.confirm(`LLM provider test failed: ${detail}\n\nSave this configuration anyway?`);
                if (!proceed) {
                    setMessage('Not saved — the provider test failed. Fix the settings and try again.');
                    return;
                }
            }
            setTestingLlm(false);
            await saveSmartZiwConfig();
        } finally {
            setTestingLlm(false);
            setSavingSmartZiwConfig(false);
        }
    };

    useEffect(() => {
        const note = releaseNotes.find((item) => item.version === selectedReleaseVersion);
        if (!note) return;
        setReleaseForm({
            version: note.version || '',
            title: note.title || '',
            summary: note.summary || '',
            itemsText: Array.isArray(note.items) ? note.items.join('\n') : '',
        });
    }, [selectedReleaseVersion, releaseNotes]);

    const createUser = async (form) => {
        setSavingDrawer(true);
        try {
            const res = await apiFetch('/api/admin/users', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: form.name, email: form.email, role: form.role, avatarUrl: form.avatarUrl, password: form.password || null }),
            });
            const data = await res.json();
            setMessage(`User created. Temporary password: ${data.temporaryPassword}`);
            setDrawer({ open: false, mode: 'create', user: null });
            loadUsers();
        } finally {
            setSavingDrawer(false);
        }
    };

    const saveUser = async (form) => {
        if (!drawer.user) return;
        setSavingDrawer(true);
        try {
            await apiFetch(`/api/admin/users/${drawer.user.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: form.name, email: form.email, role: form.role, avatarUrl: form.avatarUrl, isActive: form.isActive }),
            });
            setDrawer({ open: false, mode: 'create', user: null });
            loadUsers();
        } finally {
            setSavingDrawer(false);
        }
    };

    const resetPassword = async (newPassword) => {
        if (!resetModal.user) return;
        setResettingUserId(resetModal.user.id);
        try {
            const res = await apiFetch(`/api/admin/users/${resetModal.user.id}/reset-password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ newPassword }),
            });
            const data = await res.json();
            setResetResult(`Temporary password: ${data.temporaryPassword}`);
            setMessage(`Password reset for ${resetModal.user.email}`);
        } finally {
            setResettingUserId('');
        }
    };

    const toggleUser = async (user) => {
        setTogglingUserId(user.id);
        try {
            await apiFetch(`/api/admin/users/${user.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: user.name, email: user.email, role: user.role, avatarUrl: user.avatarUrl || '', isActive: !user.isActive }),
            });
            loadUsers();
        } finally {
            setTogglingUserId('');
        }
    };

    const filteredUsers = useMemo(() => users.filter((u) => {
        const name = String(u?.name || '').toLowerCase();
        const email = String(u?.email || '').toLowerCase();
        const query = q.trim().toLowerCase();
        if (query && !name.includes(query) && !email.includes(query)) return false;
        if (roleFilter !== 'all' && u.role !== roleFilter) return false;
        if (statusFilter === 'active' && !u.isActive) return false;
        if (statusFilter === 'disabled' && u.isActive) return false;
        return true;
    }), [users, q, roleFilter, statusFilter]);

    useEffect(() => {
        setPage(0);
    }, [q, roleFilter, statusFilter]);

    const columns = [
        { key: '_user', label: 'User', type: 'string' },
        { key: '_email', label: 'Email', type: 'string' },
        { key: '_role', label: 'Role', type: 'string' },
        { key: '_status', label: 'Status', type: 'string' },
        { key: '_lastSeen', label: 'Last Opened', type: 'date' },
        { key: '_actions', label: '', type: 'none', width: '52px' },
    ];

    const sorted = useMemo(() => {
        if (!sortCol) return filteredUsers;
        return [...filteredUsers].sort((a, b) => {
            let valA, valB;
            switch (sortCol) {
                case '_user': valA = a.name || ''; valB = b.name || ''; break;
                case '_email': valA = a.email || ''; valB = b.email || ''; break;
                case '_role': valA = a.role || ''; valB = b.role || ''; break;
                case '_status': valA = a.isActive ? 'a' : 'z'; valB = b.isActive ? 'a' : 'z'; break;
                case '_lastSeen': valA = a.lastSeenAt || ''; valB = b.lastSeenAt || ''; break;
                default: valA = ''; valB = ''; break;
            }
            const cmp = String(valA).localeCompare(String(valB), undefined, { sensitivity: 'base' });
            return sortDir === 'asc' ? cmp : -cmp;
        });
    }, [filteredUsers, sortCol, sortDir]);

    const totalPages = Math.ceil(sorted.length / rowsPerPage);
    const pageData = sorted.slice(page * rowsPerPage, (page + 1) * rowsPerPage);
    const startItem = sorted.length === 0 ? 0 : page * rowsPerPage + 1;
    const endItem = Math.min((page + 1) * rowsPerPage, sorted.length);

    const sortDescriptor = sortCol
        ? { column: sortCol, direction: sortDir === 'asc' ? 'ascending' : 'descending' }
        : undefined;

    const handleSortChange = (descriptor) => {
        setSortCol(descriptor?.column ? String(descriptor.column) : null);
        setSortDir(descriptor?.direction === 'descending' ? 'desc' : 'asc');
    };

    const startNewReleaseNote = () => {
        setSelectedReleaseVersion('__new__');
        setReleaseForm({ version: '', title: '', summary: '', itemsText: '' });
    };

    const saveReleaseNotes = async () => {
        const nextNote = {
            version: releaseForm.version.trim(),
            title: releaseForm.title.trim(),
            summary: releaseForm.summary.trim(),
            items: releaseForm.itemsText.split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
        };
        if (!nextNote.version || !nextNote.title) {
            setMessage('Version and title are required for a release note.');
            return;
        }
        const nextNotes = selectedReleaseVersion === '__new__'
            ? [nextNote, ...releaseNotes]
            : releaseNotes.map((note) => (note.version === selectedReleaseVersion ? nextNote : note));
        const normalized = [];
        const seen = new Set();
        nextNotes
            .sort((a, b) => compareVersionStrings(b.version, a.version))
            .forEach((note) => {
                if (!note.version || seen.has(note.version)) return;
                seen.add(note.version);
                normalized.push(note);
            });
        setSavingReleaseNotes(true);
        try {
            const res = await apiFetch('/api/admin/release-notes', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ notes: normalized }),
            });
            if (!res.ok) throw new Error('Failed to save release notes');
            setReleaseNotes(normalized);
            setSelectedReleaseVersion(nextNote.version);
            setMessage('Release notes saved.');
        } finally {
            setSavingReleaseNotes(false);
        }
    };

    const deleteReleaseNote = async () => {
        if (!selectedReleaseVersion || selectedReleaseVersion === '__new__') return;
        const nextNotes = releaseNotes.filter((note) => note.version !== selectedReleaseVersion);
        setSavingReleaseNotes(true);
        try {
            const res = await apiFetch('/api/admin/release-notes', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ notes: nextNotes }),
            });
            if (!res.ok) throw new Error('Failed to delete release note');
            setReleaseNotes(nextNotes);
            setSelectedReleaseVersion(nextNotes[0]?.version || '');
            setMessage('Release note deleted.');
        } finally {
            setSavingReleaseNotes(false);
        }
    };

    return (
        <div className="layout-stack admin-users-page">
            <PageHeader
                title="Admin"
                subtitle={adminTab === 'users' ? 'Create, edit, deactivate users, and reset passwords.' : adminTab === 'release-notes' ? 'Create new release notes or update existing versions.' : adminTab === 'llm' ? 'Configure the LLM backend used by the Smart-Ziw agent.' : 'Configure the Smart-Ziw agent and optional GitLab push.'}
                action={(
                    <div className="admin-users-header-actions">
                        {adminTab === 'users' ? (
                            <button
                                type="button"
                                className="profile-btn profile-btn-primary admin-toolbar-btn admin-users-create-btn"
                                disabled={savingDrawer}
                                onClick={() => setDrawer({ open: true, mode: 'create', user: null })}
                            >
                                Create User
                            </button>
                        ) : adminTab === 'release-notes' ? (
                            <button
                                type="button"
                                className="profile-btn profile-btn-primary admin-toolbar-btn admin-users-create-btn"
                                disabled={savingReleaseNotes}
                                onClick={startNewReleaseNote}
                            >
                                New Release Note
                            </button>
                        ) : null}
                    </div>
                )}
            />

            <div className="stats-row admin-stats-row">
                <div className="stat-card">
                    <span className="stat-card-label">Total Users</span>
                    <span className="stat-card-value">{users.length}</span>
                    <span className="stat-card-sub">Accounts in the system</span>
                </div>
                <div className="stat-card">
                    <span className="stat-card-label">Active Users</span>
                    <span className="stat-card-value">{users.filter((u) => u.isActive).length}</span>
                    <span className="stat-card-sub">Currently enabled</span>
                </div>
                <div className="stat-card">
                    <span className="stat-card-label">Admins</span>
                    <span className="stat-card-value">{users.filter((u) => u.role === 'admin').length}</span>
                    <span className="stat-card-sub">Privileged accounts</span>
                </div>
            </div>

            <div className="admin-page-tabs">
                <button type="button" className={`admin-page-tab ${adminTab === 'users' ? 'active' : ''}`} onClick={() => setAdminTab('users')}>User Management</button>
                <button type="button" className={`admin-page-tab ${adminTab === 'release-notes' ? 'active' : ''}`} onClick={() => setAdminTab('release-notes')}>Release Notes</button>
                <button type="button" className={`admin-page-tab ${adminTab === 'smart-ziw' ? 'active' : ''}`} onClick={() => setAdminTab('smart-ziw')}>Smart-Ziw Settings</button>
                <button type="button" className={`admin-page-tab ${adminTab === 'llm' ? 'active' : ''}`} onClick={() => setAdminTab('llm')}>LLM Provider</button>
            </div>

            {adminTab === 'users' ? (
            <div className="table-wrapper table-surface admin-users-surface">
                <div className="table-toolbar admin-users-toolbar">
                    <div className="admin-users-toolbar-row">
                        <div className="admin-users-toolbar-controls">
                            <div className="admin-users-search-slot">
                                <Input
                                    icon={SearchLg}
                                    placeholder="Search users..."
                                    value={q}
                                    onChange={handleSearchChange}
                                    className="admin-users-search-field"
                                    wrapperClassName="admin-users-search-wrapper"
                                    inputClassName="admin-users-search-input pl-11"
                                    iconClassName="admin-users-search-icon"
                                />
                            </div>
                            <div className="admin-users-filter-row">
                                <select
                                    className="filter-select filter-select-compact admin-users-filter-select"
                                    name="admin-role-filter"
                                    aria-label="Filter users by role"
                                    value={roleFilter}
                                    onChange={(e) => setRoleFilter(e.target.value)}
                                >
                                    <option value="all">All roles</option>
                                    <option value="admin">Admin</option>
                                    <option value="manager">Manager</option>
                                    <option value="user">User</option>
                                </select>
                                <select
                                    className="filter-select filter-select-compact admin-users-filter-select"
                                    name="admin-status-filter"
                                    aria-label="Filter users by status"
                                    value={statusFilter}
                                    onChange={(e) => setStatusFilter(e.target.value)}
                                >
                                    <option value="all">All status</option>
                                    <option value="active">Active</option>
                                    <option value="disabled">Disabled</option>
                                </select>
                            </div>
                        </div>
                        <div className="admin-users-toolbar-actions">
                            <span className="admin-users-toolbar-count">
                                <strong>{filteredUsers.length}</strong>
                                <span>{filteredUsers.length === 1 ? 'user' : 'users'}</span>
                            </span>
                            <button
                                type="button"
                                className="profile-btn profile-btn-secondary admin-toolbar-btn admin-users-refresh-btn"
                                onClick={loadUsers}
                                disabled={refreshingUsers}
                            >
                                {refreshingUsers ? 'Refreshing...' : 'Refresh'}
                            </button>
                        </div>
                    </div>
                </div>

                {message ? <div className="admin-users-message">{message}</div> : null}

                <Table
                    aria-label="Users table"
                    className="app-table admin-users-table"
                    sortDescriptor={sortDescriptor}
                    onSortChange={handleSortChange}
                >
                    <Table.Header columns={columns}>
                        {(col) => (
                            <Table.Head
                                id={col.key}
                                isRowHeader={col.key === '_user'}
                                allowsSorting={col.type !== 'none'}
                                className={col.key === '_actions' ? 'th-actions' : ''}
                            >
                                {col.label}
                            </Table.Head>
                        )}
                    </Table.Header>

                    <Table.Body items={pageData}>
                        {(u) => (
                            <Table.Row
                                id={u.id}
                                columns={columns}
                                className={u.isActive ? 'admin-users-row' : 'admin-users-row admin-users-row-inactive'}
                            >
                                {(columnKey) => {
                                    const key = typeof columnKey === 'string' ? columnKey : (columnKey?.key || columnKey?.id || '');
                                    if (key === '_user') {
                                        return (
                                            <Table.Cell>
                                                <div className="layout-user-cell admin-users-identity-cell">
                                                    <Avatar user={u} size={40} />
                                                    <div className="admin-users-identity-copy">
                                                        <span className="admin-users-user-name">{u.name}</span>
                                                    </div>
                                                </div>
                                            </Table.Cell>
                                        );
                                    }
                                    if (key === '_email') {
                                        return <Table.Cell><span className="admin-users-email">{u.email}</span></Table.Cell>;
                                    }
                                    if (key === '_role') {
                                        return (
                                            <Table.Cell>
                                                    <span className={`admin-users-pill admin-users-role-pill role-${u.role}`}>
                                                        {u.role === 'admin' ? 'Admin' : u.role === 'manager' ? 'Manager' : 'User'}
                                                    </span>
                                            </Table.Cell>
                                        );
                                    }
                                    if (key === '_status') {
                                        return (
                                            <Table.Cell>
                                                <span className={`admin-users-pill admin-users-status-pill ${u.isActive ? 'status-active' : 'status-disabled'}`}>
                                                    <span className="admin-users-status-dot" />
                                                    {u.isActive ? 'Active' : 'Disabled'}
                                                </span>
                                            </Table.Cell>
                                        );
                                    }
                                    if (key === '_lastSeen') {
                                        return <Table.Cell><span className="admin-users-last-login">{formatAdminDateTime(u.lastSeenAt)}</span></Table.Cell>;
                                    }
                                    return (
                                        <Table.Cell className="td-actions admin-users-actions-cell">
                                            <Dropdown.Root>
                                                <Dropdown.DotsButton className="admin-users-dots-btn" />
                                                <Dropdown.Popover className="w-min admin-users-popover">
                                                    <Dropdown.Menu className="admin-users-menu" onAction={(actionKey) => {
                                                        if (actionKey === 'edit') setDrawer({ open: true, mode: 'edit', user: u });
                                                        if (actionKey === 'reset') { setResetResult(''); setResetModal({ open: true, user: u }); }
                                                        if (actionKey === 'toggle') toggleUser(u);
                                                    }}>
                                                        <Dropdown.Item id="edit" icon={Edit01}>Edit user</Dropdown.Item>
                                                        <Dropdown.Item id="reset" icon={Key01}>{resettingUserId === u.id ? 'Resetting...' : 'Reset password'}</Dropdown.Item>
                                                        <Dropdown.Separator />
                                                        <Dropdown.Item id="toggle" icon={u.isActive ? UserX01 : UserCheck01}>
                                                            {togglingUserId === u.id ? 'Updating...' : (u.isActive ? 'Deactivate' : 'Activate')}
                                                        </Dropdown.Item>
                                                    </Dropdown.Menu>
                                                </Dropdown.Popover>
                                            </Dropdown.Root>
                                        </Table.Cell>
                                    );
                                }}
                            </Table.Row>
                        )}
                    </Table.Body>
                </Table>

                {pageData.length === 0 && (
                    <div className="table-empty-state">
                        <div className="table-empty-inner">
                            <h3>No users found</h3>
                            <p>Try adjusting your search or filters</p>
                        </div>
                    </div>
                )}

                {sorted.length > 0 && (
                    <div className="pagination-bar admin-users-pagination-bar">
                        <div className="pagination-info admin-users-pagination-info">
                            Showing <strong>{startItem}-{endItem}</strong> of <strong>{sorted.length}</strong>
                        </div>
                        {totalPages > 1 ? (
                            <div className="pagination-controls admin-users-pagination-controls">
                                <button className="pagination-btn" disabled={page === 0} onClick={() => setPage(0)} title="First page">{'<<'}</button>
                                <button className="pagination-btn" disabled={page === 0} onClick={() => setPage(page - 1)} title="Previous page">{'<'}</button>
                                <span className="pagination-pages">
                                    Page <strong>{page + 1}</strong> of <strong>{totalPages}</strong>
                                </span>
                                <button className="pagination-btn" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)} title="Next page">{'>'}</button>
                                <button className="pagination-btn" disabled={page >= totalPages - 1} onClick={() => setPage(totalPages - 1)} title="Last page">{'>>'}</button>
                            </div>
                        ) : (
                            <div className="admin-users-pagination-static">Single page</div>
                        )}
                        <div className="pagination-size admin-users-pagination-size">
                            <label htmlFor="admin-rows-per-page">Rows</label>
                            <select
                                id="admin-rows-per-page"
                                name="admin-rows-per-page"
                                aria-label="Users rows per page"
                                value={rowsPerPage}
                                onChange={(e) => { setRowsPerPage(Number(e.target.value)); setPage(0); }}
                            >
                                {[10, 25, 50].map((n) => <option key={n} value={n}>{n}</option>)}
                            </select>
                        </div>
                    </div>
                )}
            </div>
            ) : null}

            {adminTab === 'release-notes' ? (
                <div className="table-wrapper table-surface admin-release-surface">
                    <div className="admin-release-head">
                        <h3>Release Notes</h3>
                        <p>Create new release notes or update existing versions.</p>
                    </div>
                    {message ? <div className="admin-users-message">{message}</div> : null}
                    <div className="admin-release-layout">
                        <aside className="admin-release-list">
                            {releaseNotes.map((note) => (
                                <button
                                    key={note.version}
                                    type="button"
                                    className={`admin-release-list-item ${selectedReleaseVersion === note.version ? 'active' : ''}`}
                                    onClick={() => setSelectedReleaseVersion(note.version)}
                                >
                                    <span className="admin-release-version">v{note.version}</span>
                                    <strong>{note.title}</strong>
                                </button>
                            ))}
                        </aside>
                        <div className="admin-release-editor">
                            <div className="modal-grid-2col">
                                <div className="auth-field">
                                    <label className="auth-label" htmlFor="release-version">Version</label>
                                    <input id="release-version" className="auth-input" value={releaseForm.version} onChange={(e) => setReleaseForm((prev) => ({ ...prev, version: e.target.value }))} placeholder="1.3" />
                                </div>
                                <div className="auth-field">
                                    <label className="auth-label" htmlFor="release-title">Title</label>
                                    <input id="release-title" className="auth-input" value={releaseForm.title} onChange={(e) => setReleaseForm((prev) => ({ ...prev, title: e.target.value }))} placeholder="Release title" />
                                </div>
                            </div>
                            <div className="auth-field">
                                <label className="auth-label" htmlFor="release-summary">Summary</label>
                                <input id="release-summary" className="auth-input" value={releaseForm.summary} onChange={(e) => setReleaseForm((prev) => ({ ...prev, summary: e.target.value }))} placeholder="Short summary shown in the release modal" />
                            </div>
                            <div className="auth-field">
                                <label className="auth-label" htmlFor="release-items">Items</label>
                                <textarea id="release-items" className="auth-input admin-release-textarea" value={releaseForm.itemsText} onChange={(e) => setReleaseForm((prev) => ({ ...prev, itemsText: e.target.value }))} placeholder="One bullet item per line" />
                            </div>
                            <div className="admin-release-actions">
                                <button type="button" className="profile-btn profile-btn-secondary" disabled={savingReleaseNotes || selectedReleaseVersion === '__new__' || !selectedReleaseVersion} onClick={deleteReleaseNote}>Delete</button>
                                <button type="button" className="profile-btn profile-btn-primary" disabled={savingReleaseNotes} onClick={saveReleaseNotes}>
                                    {savingReleaseNotes ? 'Saving...' : 'Save Release Note'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            ) : null}

            {adminTab === 'smart-ziw' ? (
                <div className="panel-card">
                    <div className="profile-card-head">
                        <div>
                            <h3>Smart-Ziw Agent</h3>
                            <p className="profile-card-description">Configure local mirror path, web research, and optional GitLab push.</p>
                        </div>
                    </div>
                    {message ? <div className="admin-users-message">{message}</div> : null}
                    <div className="profile-settings-grid">
                        <label className="modal-toggle-row">
                            <input type="checkbox" checked={smartZiwConfig.smart_ziw_enabled} onChange={(e) => setSmartZiwConfig({ ...smartZiwConfig, smart_ziw_enabled: e.target.checked })} />
                            <span className={`modal-toggle-label ${smartZiwConfig.smart_ziw_enabled ? 'active' : 'inactive'}`}>Enable Smart-Ziw Agent</span>
                        </label>
                        <div className="auth-field profile-field-span-2">
                            <label className="auth-label">Local repo path</label>
                            <input className="auth-input" value={smartZiwConfig.smart_ziw_repo_path} onChange={(e) => setSmartZiwConfig({ ...smartZiwConfig, smart_ziw_repo_path: e.target.value })} />
                        </div>
                        <label className="modal-toggle-row">
                            <input type="checkbox" checked={smartZiwConfig.gitlab_push_enabled} onChange={(e) => setSmartZiwConfig({ ...smartZiwConfig, gitlab_push_enabled: e.target.checked })} />
                            <span className={`modal-toggle-label ${smartZiwConfig.gitlab_push_enabled ? 'active' : 'inactive'}`}>Enable GitLab push</span>
                        </label>
                        <div className="auth-field profile-field-span-2">
                            <label className="auth-label">GitLab URL</label>
                            <input className="auth-input" value={smartZiwConfig.gitlab_url} onChange={(e) => setSmartZiwConfig({ ...smartZiwConfig, gitlab_url: e.target.value })} />
                        </div>
                        <div className="auth-field profile-field-span-2">
                            <label className="auth-label">GitLab token</label>
                            <input className="auth-input" type="password" value={smartZiwConfig.gitlab_token} onChange={(e) => setSmartZiwConfig({ ...smartZiwConfig, gitlab_token: e.target.value })} />
                        </div>
                        <div className="auth-field profile-field-span-2">
                            <label className="auth-label">GitLab project path</label>
                            <input className="auth-input" value={smartZiwConfig.gitlab_project_path} onChange={(e) => setSmartZiwConfig({ ...smartZiwConfig, gitlab_project_path: e.target.value })} />
                        </div>
                        <div className="auth-field">
                            <label className="auth-label">Branch</label>
                            <input className="auth-input" value={smartZiwConfig.gitlab_branch} onChange={(e) => setSmartZiwConfig({ ...smartZiwConfig, gitlab_branch: e.target.value })} />
                        </div>
                        <div className="auth-field">
                            <label className="auth-label">Author name</label>
                            <input className="auth-input" value={smartZiwConfig.gitlab_author_name} onChange={(e) => setSmartZiwConfig({ ...smartZiwConfig, gitlab_author_name: e.target.value })} />
                        </div>
                        <div className="auth-field profile-field-span-2">
                            <label className="auth-label">Author email</label>
                            <input className="auth-input" value={smartZiwConfig.gitlab_author_email} onChange={(e) => setSmartZiwConfig({ ...smartZiwConfig, gitlab_author_email: e.target.value })} />
                        </div>
                        <h4 style={{ gridColumn: '1 / -1', margin: '8px 0 0' }}>Web research</h4>
                        <label className="modal-toggle-row">
                            <input type="checkbox" checked={smartZiwConfig.smart_ziw_research_enabled} onChange={(e) => setSmartZiwConfig({ ...smartZiwConfig, smart_ziw_research_enabled: e.target.checked })} />
                            <span className={`modal-toggle-label ${smartZiwConfig.smart_ziw_research_enabled ? 'active' : 'inactive'}`}>Enable web research (Firecrawl)</span>
                        </label>
                        <div className="auth-field profile-field-span-2">
                            <label className="auth-label">Firecrawl API key</label>
                            <input className="auth-input" type="password" value={smartZiwConfig.firecrawl_api_key} onChange={(e) => setSmartZiwConfig({ ...smartZiwConfig, firecrawl_api_key: e.target.value })} placeholder="Leave blank to keep the stored key" />
                        </div>
                        <div className="auth-field profile-field-span-2">
                            <label className="auth-label">Firecrawl base URL</label>
                            <input className="auth-input" value={smartZiwConfig.firecrawl_base_url} onChange={(e) => setSmartZiwConfig({ ...smartZiwConfig, firecrawl_base_url: e.target.value })} />
                        </div>
                        <div className="auth-field">
                            <label className="auth-label">Research timeout (seconds)</label>
                            <input className="auth-input" type="number" min={1} value={smartZiwConfig.smart_ziw_research_timeout_seconds} onChange={(e) => { const value = Number(e.target.value); setSmartZiwConfig({ ...smartZiwConfig, smart_ziw_research_timeout_seconds: Number.isFinite(value) && value >= 1 ? value : 900 }) }} />
                        </div>
                    </div>
                    <div className="profile-card-footer profile-card-footer-end">
                        <button type="button" className="profile-btn profile-btn-primary" onClick={saveSmartZiwConfig} disabled={savingSmartZiwConfig}>
                            {savingSmartZiwConfig ? 'Saving...' : 'Save config'}
                        </button>
                    </div>
                </div>
            ) : null}

            {adminTab === 'llm' ? (
                <div className="panel-card">
                    <div className="profile-card-head">
                        <div>
                            <h3>LLM Provider</h3>
                            <p className="profile-card-description">Configure the LLM backend used by the Smart-Ziw agent.</p>
                        </div>
                    </div>
                    {message ? <div className="admin-users-message">{message}</div> : null}
                    <div className="profile-settings-grid">
                        <div className="auth-field profile-field-span-2">
                            <label className="auth-label">Configuration source</label>
                            <div className="llm-source-options">
                                <label className="llm-source-option">
                                    <input type="radio" name="llm-source" checked={llmSource === 'environment'} onChange={() => { llmDiscoverySeq.current += 1; setLlmModelsLoading(false); setSmartZiwConfig({ ...smartZiwConfig, smart_ziw_llm_provider: 'deepseek' }); }} />
                                    <span>
                                        <strong>Environment (.env)</strong>
                                        <em>Use the DeepSeek settings from the backend .env file.</em>
                                    </span>
                                </label>
                                <label className="llm-source-option">
                                    <input type="radio" name="llm-source" checked={llmSource === 'lightllm'} onChange={() => { llmDiscoverySeq.current += 1; setLlmModelsLoading(false); setSmartZiwConfig({ ...smartZiwConfig, smart_ziw_llm_provider: 'lightllm' }); }} />
                                    <span>
                                        <strong>LightLLM</strong>
                                        <em>Use your own OpenAI- or Anthropic-compatible LLM server.</em>
                                    </span>
                                </label>
                            </div>
                        </div>
                        {llmSource === 'environment' ? (
                            <div className="auth-field profile-field-span-2">
                                <label className="auth-label">Environment configuration</label>
                                <p className="llm-env-info">
                                    {llmEnvStatus.model
                                        ? <>Using model <code>{llmEnvStatus.model}</code> from environment configuration ({llmEnvStatus.api_key_set ? 'API key set' : 'no API key set'}). To change these values, edit the .env file on the server and restart the backend.</>
                                        : 'Loading environment status…'}
                                </p>
                            </div>
                        ) : (
                            <>
                                <div className="auth-field profile-field-span-2">
                                    <label className="auth-label">LightLLM base URL</label>
                                    <input className="auth-input" value={smartZiwConfig.lightllm_base_url} onChange={(e) => { llmDiscoverySeq.current += 1; setLlmModelsLoading(false); setLlmModels({ status: 'idle', models: [], detail: null }); setSmartZiwConfig({ ...smartZiwConfig, lightllm_base_url: e.target.value }); }} placeholder="http://localhost:8000/v1" />
                                </div>
                                <div className="auth-field">
                                    <label className="auth-label">LightLLM API key</label>
                                    <input className="auth-input" type="password" value={smartZiwConfig.lightllm_api_key} onChange={(e) => setSmartZiwConfig({ ...smartZiwConfig, lightllm_api_key: e.target.value })} placeholder="Leave blank to keep the stored key" />
                                </div>
                                <div className="auth-field">
                                    <label className="auth-label">Provider (server type)</label>
                                    <select className="auth-input" value={smartZiwConfig.lightllm_provider} onChange={(e) => { llmDiscoverySeq.current += 1; setLlmModelsLoading(false); setSmartZiwConfig({ ...smartZiwConfig, lightllm_provider: e.target.value }); }}>
                                        <option value="openai_compatible">OpenAI-compatible</option>
                                        <option value="anthropic_compatible">Anthropic-compatible</option>
                                        <option value="custom">Custom (enter model manually)</option>
                                    </select>
                                </div>
                                <div className="auth-field profile-field-span-2">
                                    <label className="auth-label">LightLLM model</label>
                                    {(smartZiwConfig.lightllm_provider === 'openai_compatible' || smartZiwConfig.lightllm_provider === 'anthropic_compatible') && llmModels.status === 'ok' ? (
                                        <select className="auth-input" value={smartZiwConfig.lightllm_model} onChange={(e) => setSmartZiwConfig({ ...smartZiwConfig, lightllm_model: e.target.value })}>
                                            {!llmModels.models.some((m) => m.id === smartZiwConfig.lightllm_model) && smartZiwConfig.lightllm_model ? (
                                                <option value={smartZiwConfig.lightllm_model}>{smartZiwConfig.lightllm_model} (current)</option>
                                            ) : null}
                                            {llmModels.models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                                        </select>
                                    ) : (
                                        <input className="auth-input" value={smartZiwConfig.lightllm_model} onChange={(e) => setSmartZiwConfig({ ...smartZiwConfig, lightllm_model: e.target.value })} />
                                    )}
                                    <p className="llm-models-status">
                                        {llmModels.status === 'loading' ? 'Loading available models…'
                                            : llmModels.status === 'ok' ? 'Models loaded.'
                                            : llmModels.status === 'no_models' ? 'No models available from this server. You can type the model name manually.'
                                            : llmModels.status === 'auth_required' ? 'This provider requires an API key to retrieve available models. Enter the API key and refresh.'
                                            : llmModels.status === 'unsupported' ? 'This provider does not support automatic model discovery. Enter the model name manually.'
                                            : llmModels.status === 'error' ? (llmModels.detail || 'Unable to connect to the LightLLM server. Check the base URL.')
                                            : ''}
                                    </p>
                                    <button type="button" className="profile-btn" onClick={() => discoverLlmModels(smartZiwConfig.lightllm_provider, smartZiwConfig.lightllm_base_url, smartZiwConfig.lightllm_api_key)} disabled={llmModelsLoading || smartZiwConfig.lightllm_provider === 'custom' || !smartZiwConfig.lightllm_base_url.trim()}>
                                        Refresh models
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                    <details className="llm-advanced">
                        <summary className="llm-advanced-summary">Advanced settings</summary>
                        <div className="profile-settings-grid">
                            <div className="auth-field">
                                <label className="auth-label">Temperature</label>
                                <input className="auth-input" type="number" min="0" max="2" step="0.1" value={smartZiwConfig.llm_temperature ?? 0.1} onChange={(e) => { const value = parseFloat(e.target.value); setSmartZiwConfig({ ...smartZiwConfig, llm_temperature: Number.isFinite(value) ? value : 0.1 }); }} />
                                <p className="llm-models-status">Controls response randomness. Default 0.1. Some models (e.g. reasoning models) only accept 1.</p>
                            </div>
                            <div className="auth-field">
                                <label className="auth-label">Max tokens</label>
                                <input className="auth-input" type="number" min="1" step="1" value={smartZiwConfig.llm_max_tokens ?? 4000} onChange={(e) => { const value = parseInt(e.target.value, 10); setSmartZiwConfig({ ...smartZiwConfig, llm_max_tokens: Number.isFinite(value) ? value : 4000 }); }} />
                                <p className="llm-models-status">Maximum tokens per response. Default 4000.</p>
                            </div>
                        </div>
                    </details>
                    <div className="profile-card-footer profile-card-footer-end">
                        <button type="button" className="profile-btn profile-btn-primary" onClick={testAndSaveLlmConfig} disabled={savingSmartZiwConfig}>
                            {testingLlm ? 'Testing…' : savingSmartZiwConfig ? 'Saving...' : 'Save config'}
                        </button>
                    </div>
                </div>
            ) : null}

            <UserDrawer
                open={drawer.open}
                mode={drawer.mode}
                initialUser={drawer.user}
                onClose={() => setDrawer({ open: false, mode: 'create', user: null })}
                onSave={drawer.mode === 'create' ? createUser : saveUser}
                saving={savingDrawer}
            />
            <ResetPasswordModal
                open={resetModal.open}
                user={resetModal.user}
                onClose={() => setResetModal({ open: false, user: null })}
                onReset={resetPassword}
                saving={resettingUserId === resetModal.user?.id}
                result={resetResult}
            />
        </div>
    );
}

export default function App() {
    const [loading, setLoading] = useState(true);
    const [projects, setProjects] = useState([]);
    const [regions, setRegions] = useState({});
    const [continents, setContinents] = useState([]);
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
    const [autoFilterApplied, setAutoFilterApplied] = useState(false);
    const [showAutoFilterToast, setShowAutoFilterToast] = useState(false);
    const [demoOpen, setDemoOpen] = useState(false);

    const [authUser, setAuthUser] = useState(null);
    const [availableUsers, setAvailableUsers] = useState([]);
    const [authError, setAuthError] = useState('');
    const [mustChangeError, setMustChangeError] = useState('');
    const [bootstrapStatus, setBootstrapStatus] = useState(null);
    const [releaseNotesOpen, setReleaseNotesOpen] = useState(false);
    const [releaseNotes, setReleaseNotes] = useState(DEFAULT_RELEASE_NOTES);

    const [route, setRoute] = useState(normalizeRoute(window.location.hash.replace('#', '')));
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const [mobileNavOpen, setMobileNavOpen] = useState(false);
    const [commandOpen, setCommandOpen] = useState(false);
    const [commentsOpen, setCommentsOpen] = useState(false);
    const [selectedProject, setSelectedProject] = useState(null);
    const [selectedProjectIndex, setSelectedProjectIndex] = useState(null);
    const [commentsMine, setCommentsMine] = useState(false);
    const [commentsBody, setCommentsBody] = useState('');
    const [comments, setComments] = useState([]);
    const [syncOpen, setSyncOpen] = useState(false);
    const [configOpen, setConfigOpen] = useState(false);
    const [scheduleOpen, setScheduleOpen] = useState(false);
    const [notificationsOpen, setNotificationsOpen] = useState(false);
    const [notifications, setNotifications] = useState([]);
    const [expiringSoonOnly, setExpiringSoonOnly] = useState(false);
    const [expiringSoonDays, setExpiringSoonDays] = useState(5);
    const [savedSearches, setSavedSearches] = useState([]);
    const preSyncIdsRef = useRef(new Set());
    const notificationAudioRef = useRef(null);
    const notificationStreamRef = useRef(null);
    const notificationAudioUnlockedRef = useRef(false);

    // ⌘K / Ctrl+K opens the command palette (sidebar search + navigation)
    useEffect(() => {
        const handleKeyDown = (event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
                event.preventDefault();
                setCommandOpen(true);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    const focusTenderSearch = () => {
        setTimeout(() => {
            document.querySelector('input[name="projectSearch"]')?.focus();
        }, 50);
    };

    const apiFetch = useCallback(async (url, opts = {}, _isRetry = false) => {
        const headers = { ...(opts.headers || {}) };
        const token = localStorage.getItem('pw_access_token');
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
        const res = await fetch(url, { ...opts, headers });
        // Auto-refresh on 401
        if (res.status === 401 && !_isRetry) {
            const refreshToken = localStorage.getItem('pw_refresh_token');
            if (refreshToken) {
                try {
                    const rr = await fetch('/api/auth/refresh', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ refreshToken }),
                    });
                    if (rr.ok) {
                        const rd = await rr.json();
                        localStorage.setItem('pw_access_token', rd.accessToken);
                        if (rd.user) setAuthUser(rd.user);
                        return apiFetch(url, opts, true);
                    }
                } catch { /* fall through */ }
            }
            localStorage.removeItem('pw_access_token');
            localStorage.removeItem('pw_refresh_token');
            setAuthUser(null);
            throw new Error('Unauthorized');
        }
        return res;
    }, []);

    const loadSession = useCallback(async () => {
        try {
            const b = await fetch('/api/auth/bootstrap-status');
            if (b.ok) setBootstrapStatus(await b.json());
            const token = localStorage.getItem('pw_access_token');
            if (!token) return;
            const res = await fetch('/api/auth/me', {
                headers: { 'Authorization': `Bearer ${token}` },
            });
            if (res.ok) {
                const data = await res.json();
                setAuthUser(data.user);
            } else if (res.status === 401) {
                // Try refresh
                const refreshToken = localStorage.getItem('pw_refresh_token');
                if (refreshToken) {
                    const rr = await fetch('/api/auth/refresh', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ refreshToken }),
                    });
                    if (rr.ok) {
                        const rd = await rr.json();
                        localStorage.setItem('pw_access_token', rd.accessToken);
                        setAuthUser(rd.user);
                    } else {
                        localStorage.removeItem('pw_access_token');
                        localStorage.removeItem('pw_refresh_token');
                    }
                }
            }
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadSession();
    }, [loadSession]);

    useEffect(() => {
        const onHash = () => {
            const rawHash = window.location.hash.replace('#', '');
            setRoute(normalizeRoute(rawHash));
            if (!getTenderIdFromHash(window.location.hash)) {
                setSelectedProject(null);
                setSelectedProjectIndex(null);
                setCommentsOpen(false);
            }
        };
        window.addEventListener('hashchange', onHash);
        return () => window.removeEventListener('hashchange', onHash);
    }, []);



    useEffect(() => {
        if (!notificationAudioRef.current) {
            const audio = new Audio('/notif.mp3');
            audio.preload = 'auto';
            notificationAudioRef.current = audio;
        }
    }, []);

    useEffect(() => {
        if (!authUser || authUser.mustChangePassword || notificationAudioUnlockedRef.current) return undefined;

        const unlockAudio = () => {
            const audio = notificationAudioRef.current;
            if (!audio || notificationAudioUnlockedRef.current) return;
            try {
                audio.muted = true;
                const playPromise = audio.play();
                if (playPromise?.then) {
                    playPromise
                        .then(() => {
                            audio.pause();
                            audio.currentTime = 0;
                            audio.muted = false;
                            notificationAudioUnlockedRef.current = true;
                        })
                        .catch(() => {
                            audio.muted = false;
                        });
                } else {
                    audio.pause();
                    audio.currentTime = 0;
                    audio.muted = false;
                    notificationAudioUnlockedRef.current = true;
                }
            } catch {
                audio.muted = false;
            }
        };

        const opts = { capture: true, passive: true };
        window.addEventListener('pointerdown', unlockAudio, opts);
        window.addEventListener('keydown', unlockAudio, true);
        window.addEventListener('touchstart', unlockAudio, opts);

        return () => {
            window.removeEventListener('pointerdown', unlockAudio, opts);
            window.removeEventListener('keydown', unlockAudio, true);
            window.removeEventListener('touchstart', unlockAudio, opts);
        };
    }, [authUser]);

    useEffect(() => {
        if (notificationStreamRef.current) {
            notificationStreamRef.current.close();
            notificationStreamRef.current = null;
        }
        if (!authUser || authUser.mustChangePassword) return undefined;

        const eventSource = new EventSource(buildNotificationStreamUrl());
        notificationStreamRef.current = eventSource;

        eventSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data?.type === 'notification' && data?.notification) {
                    setNotifications((prev) => [data.notification, ...prev.filter((item) => item.id !== data.notification.id)]);
                    return;
                }
                if (data?.type !== 'new_projects' || !(data?.count > 0)) return;
                if (document.visibilityState !== 'visible' || !document.hasFocus()) return;
                const audio = notificationAudioRef.current;
                if (!audio) return;
                audio.currentTime = 0;
                audio.play().catch(() => {
                    notificationAudioUnlockedRef.current = false;
                });
            } catch {
                // Ignore malformed notification payloads.
            }
        };

        eventSource.onerror = () => {
            // Let EventSource handle automatic reconnects; no-op here.
        };

        return () => {
            if (notificationStreamRef.current === eventSource) {
                eventSource.close();
                notificationStreamRef.current = null;
            } else {
                eventSource.close();
            }
        };
    }, [authUser]);

    const latestReleaseVersion = useMemo(
        () => releaseNotes[0]?.version || APP_RELEASE_VERSION,
        [releaseNotes],
    );

    useEffect(() => {
        if (!authUser || authUser.mustChangePassword) return;
        let seenVersion = '0';
        try {
            seenVersion = localStorage.getItem(RELEASE_NOTES_STORAGE_KEY) || '0';
        } catch {
            seenVersion = '0';
        }
        if (compareVersionStrings(latestReleaseVersion, seenVersion) > 0) {
            setReleaseNotesOpen(true);
        }
    }, [authUser, latestReleaseVersion]);

    const loadProjects = useCallback(async () => {
        const res = await apiFetch(`${API}/projects`);
        const data = await res.json();
        setProjects(attachProjectRowIds(Array.isArray(data) ? data : []));
    }, [apiFetch]);

    useEffect(() => {
        if (projects.length === 0 || autoFilterApplied) return;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
        const fmt = (d) => d.toISOString().split('T')[0];
        setScrapedFrom(fmt(weekAgo));
        setScrapedTo(fmt(today));
        setAutoFilterApplied(true);
        setShowAutoFilterToast(true);
        toast('Showing tenders scraped in the last 7 days.', {
            action: { label: 'Show all', onClick: clearAutoFilter },
            closeButton: true,
        });
    }, [projects, autoFilterApplied]);

    useEffect(() => {
        if (!authUser || authUser.mustChangePassword) return;
        loadProjects();
        Promise.all([
            apiFetch('/api/config').then((r) => (r.ok ? r.json() : { regions: {} })),
            apiFetch('/api/geography').then((r) => (r.ok ? r.json() : { continents: [] })),
            apiFetch('/api/release-notes').then((r) => (r.ok ? r.json() : { notes: DEFAULT_RELEASE_NOTES })),
            apiFetch('/api/users').then((r) => (r.ok ? r.json() : [])),
            apiFetch('/api/notifications?limit=5000').then((r) => (r.ok ? r.json() : { notifications: [] })),
            apiFetch('/api/saved-searches').then((r) => (r.ok ? r.json() : { searches: [] })),
        ])
            .then(([cfg, geography, noteData, userData, notificationData, searchData]) => {
                setRegions(cfg.regions || {});
                setContinents(geography.continents || []);
                const notes = Array.isArray(noteData?.notes) && noteData.notes.length ? noteData.notes : DEFAULT_RELEASE_NOTES;
                setReleaseNotes([...notes].sort((a, b) => compareVersionStrings(b.version, a.version)));
                setAvailableUsers(Array.isArray(userData) ? userData : []);
                setNotifications(Array.isArray(notificationData?.notifications) ? notificationData.notifications : []);
                setSavedSearches(Array.isArray(searchData?.searches) ? searchData.searches : []);
            })
            .catch(() => { });
    }, [authUser, loadProjects, apiFetch]);

    const doLogin = async (email, password) => {
        setAuthError('');
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
        });
        const data = await res.json();
        if (!res.ok) {
            setAuthError(data.detail || 'Login failed');
            return;
        }
        localStorage.setItem('pw_access_token', data.accessToken);
        localStorage.setItem('pw_refresh_token', data.refreshToken);
        setAuthUser(data.user);
    };

    const doChangePassword = async (newPassword) => {
        try {
            const res = await apiFetch('/api/auth/change-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ newPassword }),
            });
            if (!res.ok) throw new Error('Failed to update password');
            await loadSession();
        } catch (e) {
            setMustChangeError(e.message);
        }
    };

    const doLogout = async () => {
        try { await apiFetch('/api/auth/logout', { method: 'POST' }); } catch { /* ignore */ }
        localStorage.removeItem('pw_access_token');
        localStorage.removeItem('pw_refresh_token');
        setAuthUser(null);
    };

    const latestReleaseNote = useMemo(() => {
        if (!releaseNotes.length) return DEFAULT_RELEASE_NOTES[0];
        return releaseNotes[0];
    }, [releaseNotes]);

    const groupedNotifications = useMemo(
        () => buildGroupedNotifications(notifications, projects),
        [notifications, projects],
    );

    const unreadNotificationCount = useMemo(
        () => groupedNotifications.filter((item) => !item.read).length,
        [groupedNotifications],
    );

    const modalReleaseNotes = useMemo(() => {
        let seenVersion = '0';
        try {
            seenVersion = localStorage.getItem(RELEASE_NOTES_STORAGE_KEY) || '0';
        } catch {
            seenVersion = '0';
        }
        if (compareVersionStrings(latestReleaseNote?.version || '0', seenVersion) > 0) {
            return latestReleaseNote ? [latestReleaseNote] : [];
        }
        return latestReleaseNote ? [latestReleaseNote] : [];
    }, [latestReleaseNote]);

    const markReleaseNotesSeen = useCallback(() => {
        try {
            localStorage.setItem(RELEASE_NOTES_STORAGE_KEY, latestReleaseVersion);
        } catch {
            // Ignore localStorage access issues.
        }
    }, [latestReleaseVersion]);

    const closeReleaseNotes = useCallback(() => {
        markReleaseNotesSeen();
        setReleaseNotesOpen(false);
    }, [markReleaseNotesSeen]);

    const markNotificationAsRead = useCallback(async (notificationId) => {
        setNotifications((prev) => prev.map((item) => (item.id === notificationId ? { ...item, read: true } : item)));
        await apiFetch(`/api/notifications/${encodeURIComponent(notificationId)}/read`, { method: 'POST' }).catch(() => {});
    }, [apiFetch]);

    const markNotificationGroupAsRead = useCallback(async (notificationIds = []) => {
        const ids = [...new Set((notificationIds || []).filter(Boolean))];
        if (!ids.length) return;
        setNotifications((prev) => prev.map((item) => (
            ids.includes(item.id) ? { ...item, read: true, viewed: true } : item
        )));
        await Promise.all(ids.map((id) => apiFetch(`/api/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' }).catch(() => {})));
    }, [apiFetch]);

    const markAllNotificationsViewed = useCallback(async () => {
        setNotifications((prev) => prev.map((item) => ({ ...item, viewed: true })));
        await apiFetch('/api/notifications/view-all', { method: 'POST' }).catch(() => {});
    }, [apiFetch]);

    const markAllNotificationsAsRead = useCallback(async () => {
        setNotifications((prev) => prev.map((item) => ({ ...item, read: true, viewed: true })));
        await apiFetch('/api/notifications/read-all', { method: 'POST' }).catch(() => {});
    }, [apiFetch]);

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


    const sources = useMemo(() => [...new Set(projects.map((p) => p.source).filter(Boolean))].sort(), [projects]);

    const dashboardStats = useMemo(() => {
        const now = new Date();
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const newThisWeek = projects.filter((p) => {
            const d = p.scraped_at ? new Date(p.scraped_at) : null;
            return d && d >= weekAgo;
        }).length;
        const pendingReview = projects.filter((p) => !p.decision || p.decision === 'Pending').length;
        const expiringSoon = projects.filter((p) => {
            if (!p.project_end_date) return false;
            const end = new Date(p.project_end_date);
            const daysLeft = Math.ceil((end - now) / (1000 * 60 * 60 * 24));
            return daysLeft > 0 && daysLeft <= 30;
        }).length;
        return {
            total: projects.length,
            newThisWeek,
            pendingReview,
            sourcesCount: sources.length,
            expiringSoon,
        };
    }, [projects, sources]);

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
        setShowAutoFilterToast(false);
    };

    const clearAutoFilter = () => {
        setScrapedFrom('');
        setScrapedTo('');
        setShowAutoFilterToast(false);
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

    const canManageDecision = authUser?.role === 'manager';
    const canEditDeadline = authUser?.role === 'admin' || authUser?.role === 'manager';

    const handleDecisionChange = async (index, nextDecision) => {
        if (!canManageDecision) return;
        const project = projects[index];
        setProjects((prev) => {
            const next = [...prev];
            next[index] = { ...next[index], decision: nextDecision };
            return next;
        });
        if (selectedProjectIndex === index) {
            setSelectedProject((prev) => (prev ? { ...prev, decision: nextDecision } : prev));
        }
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
    }, [selectedProject?.db_id, apiFetch]);

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

    const snapshotBeforeSync = useCallback(() => {
        preSyncIdsRef.current = new Set(projects.map((p) => `${p.project_id}__${p.project_name}`));
    }, [projects]);

    const handleSyncDone = useCallback(async () => {
        const prevIds = preSyncIdsRef.current;
        const res = await apiFetch(`${API}/projects`);
        const data = await res.json();
        const normalized = attachProjectRowIds(Array.isArray(data) ? data : []);
        setProjects(normalized);
        const newIds = new Set();
        normalized.forEach((p) => {
            const key = `${p.project_id}__${p.project_name}`;
            if (!prevIds.has(key)) newIds.add(key);
        });
        setNewProjectIds(newIds);
    }, [apiFetch]);

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
            const res = await apiFetch(`/api/comments?entityType=${encodeURIComponent(selectedEntityType)}&entityId=${encodeURIComponent(selectedEntityId)}&mine=${commentsMine}`);
            const data = await res.json();
            if (!cancelled) setComments(data);
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
        setRoute('dashboard');
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

    const openProjectFromNotification = useCallback(async (notification) => {
        if (!notification) return;
        const project = projects.find((item) => (
            (notification.projectDbId && item.db_id === notification.projectDbId)
            || (notification.entityId && (item.project_id === notification.entityId || item.project_name === notification.entityId))
        ));
        if (!project) {
            window.alert('Project not found for this notification.');
            return;
        }
        const projectIndex = projects.findIndex((item) => item.db_id === project.db_id);
        if (!notification.read) {
            await markNotificationGroupAsRead(notification.notificationIds || [notification.id]);
        }
        setNotificationsOpen(false);
        setRoute('dashboard');
        window.location.hash = buildTenderHash(project.db_id);
        setSelectedProject(project);
        setSelectedProjectIndex(projectIndex >= 0 ? projectIndex : null);
        setCommentsOpen(true);
    }, [projects, markNotificationGroupAsRead]);

    const navigate = (key) => {
        if (key === 'logout') {
            doLogout();
            return;
        }
        if (key === 'schedule') {
            setScheduleOpen(true);
            return;
        }
        if (key === 'settings') {
            setConfigOpen(true);
            return;
        }
        setRoute(key);
        window.location.hash = `#${key}`;
    };

    useEffect(() => {
        if (!notificationsOpen) return;
        markAllNotificationsViewed();
    }, [notificationsOpen, markAllNotificationsViewed]);

    const handleHeaderMenuAction = (key) => {
        if (key === 'profile') navigate('profile');
        else if (key === 'admin') navigate('admin');
        else if (key === 'settings') setConfigOpen(true);
        else if (key === 'schedule') setScheduleOpen(true);
        else if (key === 'logout') doLogout();
    };

    if (loading) return <div className="app"><div className="loading"><div className="spinner" /><p>Loading...</p></div></div>;
    if (!authUser) return <LoginPage onLogin={doLogin} error={authError} bootstrap={bootstrapStatus} />;
    if (authUser.mustChangePassword) return <ForcePasswordPage onSubmit={doChangePassword} error={mustChangeError} />;

    return (
        <div className="layout-root">
            <Toaster />
            <SidebarProvider open={!sidebarCollapsed} onOpenChange={(open) => setSidebarCollapsed(!open)}>
                <Sidebar
                    user={authUser}
                    route={route}
                    onNavigate={navigate}
                    onCloseMobile={() => setMobileNavOpen(false)}
                    onOpenCommand={() => setCommandOpen(true)}
                />
                <div className="layout-main">
                <div className="layout-page-scroll">
                    <div className="layout-shell-container layout-page-container">
                        {route === 'dashboard' || route === 'tenders' || (ADMIN_ROUTES.includes(route) && authUser.role !== 'admin') ? (
                            <div className="layout-dashboard layout-content-row">
                                <div className="layout-dashboard-main">
                                    <PageHeader
                                        title="Procurement Watch"
                                        subtitle="Track tenders, review sources, and manage decisions."
                                        className="layout-page-header-compact"
                                        action={(
                                            <div className="header-actions dashboard-header-actions">
                                                <div className="header-buttons dashboard-header-buttons">
                                                    <TooltipProvider>
                                                        <Tooltip>
                                                            <TooltipTrigger asChild>
                                                                <ShadcnButton variant="ghost" size="icon" className="relative" aria-label="Notifications" onClick={() => setNotificationsOpen(true)}>
                                                                    <Bell className="h-5 w-5" />
                                                                    {unreadNotificationCount ? <Badge variant="destructive" className="absolute -right-1 -top-1 h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] leading-none">{unreadNotificationCount}</Badge> : null}
                                                                </ShadcnButton>
                                                            </TooltipTrigger>
                                                            <TooltipContent>Notifications</TooltipContent>
                                                        </Tooltip>
                                                        <Tooltip>
                                                            <TooltipTrigger asChild>
                                                                <ShadcnButton variant="ghost" size="icon" aria-label="Sync now" onClick={() => setSyncOpen(true)}>
                                                                    <RefreshCw className="h-5 w-5" />
                                                                </ShadcnButton>
                                                            </TooltipTrigger>
                                                            <TooltipContent>Sync now</TooltipContent>
                                                        </Tooltip>
                                                    </TooltipProvider>
                                                    <DropdownMenu>
                                                        <DropdownMenuTrigger asChild>
                                                            <ShadcnButton variant="ghost" size="icon" className="rounded-full" aria-label="Account menu">
                                                                <Avatar user={authUser} size={32} />
                                                            </ShadcnButton>
                                                        </DropdownMenuTrigger>
                                                        <DropdownMenuContent align="end">
                                                            <DropdownMenuItem onSelect={() => handleHeaderMenuAction('profile')}>
                                                                <User className="mr-2 h-4 w-4" />Profile
                                                            </DropdownMenuItem>
                                                            {authUser.role === 'admin' ? (
                                                                <DropdownMenuItem onSelect={() => handleHeaderMenuAction('admin')}>
                                                                    <Shield className="mr-2 h-4 w-4" />Admin
                                                                </DropdownMenuItem>
                                                            ) : null}
                                                            <DropdownMenuItem onSelect={() => handleHeaderMenuAction('settings')}>
                                                                <Settings className="mr-2 h-4 w-4" />Settings
                                                            </DropdownMenuItem>
                                                            <DropdownMenuItem onSelect={() => handleHeaderMenuAction('schedule')}>
                                                                <CalendarClock className="mr-2 h-4 w-4" />Schedule
                                                            </DropdownMenuItem>
                                                            <DropdownMenuSeparator />
                                                            <DropdownMenuItem onSelect={() => handleHeaderMenuAction('logout')}>
                                                                <LogOut className="mr-2 h-4 w-4" />Logout
                                                            </DropdownMenuItem>
                                                        </DropdownMenuContent>
                                                    </DropdownMenu>
                                                </div>
                                            </div>
                                        )}
                                    />
                                    <div className="stats-row">
                                        <div className="stat-card">
                                            <span className="stat-card-label">Total Tenders</span>
                                            <span className="stat-card-value">{dashboardStats.total}</span>
                                            <span className="stat-card-sub">Across {dashboardStats.sourcesCount} sources</span>
                                        </div>
                                        <div className="stat-card">
                                            <span className="stat-card-label">New This Week</span>
                                            <span className="stat-card-value">{dashboardStats.newThisWeek}</span>
                                            <span className="stat-card-sub">Scraped in last 7 days</span>
                                        </div>
                                        <div className="stat-card">
                                            <span className="stat-card-label">Pending Review</span>
                                            <span className="stat-card-value">{dashboardStats.pendingReview}</span>
                                            <span className="stat-card-sub">Awaiting decision</span>
                                        </div>
                                        <div className="stat-card">
                                            <span className="stat-card-label">Expiring Soon</span>
                                            <span className="stat-card-value">{dashboardStats.expiringSoon}</span>
                                            <span className="stat-card-sub"><strong>30</strong> day window</span>
                                        </div>
                                    </div>
                                    <ProjectTable
                                        projects={filtered}
                                        allProjects={projects}
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
                                        autoFilterActive={showAutoFilterToast}
                                        onClearAutoFilter={clearAutoFilter}
                                        onStartDemo={() => setDemoOpen(true)}
                                        onProjectSelect={(project, projectIndex) => {
                                            setSelectedProject(project);
                                            setSelectedProjectIndex(projectIndex);
                                            setCommentsOpen(true);
                                            if (project?.db_id) {
                                                window.location.hash = buildTenderHash(project.db_id);
                                            }
                                        }}
                                    />
                                </div>
                            </div>
                        ) : null}

                        {ADMIN_ROUTES.includes(route) && authUser.role === 'admin' ? (
                            <AdminPage
                                key={route}
                                apiFetch={apiFetch}
                                initialTab={route === 'llm-config' ? 'llm' : route === 'smart-ziw' ? 'smart-ziw' : 'users'}
                            />
                        ) : null}
                        {route === 'analytics' ? <AnalyticsPage /> : null}
                        {route === 'profile' ? <ProfilePage user={authUser} apiFetch={apiFetch} onUserUpdate={setAuthUser} /> : null}
                        {route === 'release-notes' ? <ReleaseNotesPage releases={releaseNotes} onBack={() => navigate('dashboard')} /> : null}
                    </div>
                </div>
            </div>
            </SidebarProvider>

            <CommentsPanel
                open={commentsOpen}
                entity={selectedEntity}
                project={selectedProject}
                projectRegion={selectedProject ? (selectedProject.primary_region_name || getRegion(selectedProject.project_sponsor)) : ''}
                comments={comments}
                mine={commentsMine}
                setMine={setCommentsMine}
                body={commentsBody}
                setBody={setCommentsBody}
                onSubmit={submitComment}
                onClose={clearActiveProject}
                currentUser={authUser}
                apiFetch={apiFetch}
                availableUsers={availableUsers}
                shareUrl={selectedProjectShareUrl}
                onDecisionChange={(nextDecision) => {
                    if (selectedProjectIndex !== null) handleDecisionChange(selectedProjectIndex, nextDecision);
                }}
                onDeadlineSave={(nextDeadline) => {
                    if (selectedProjectIndex !== null) return handleDeadlineChange(selectedProjectIndex, nextDeadline);
                    return Promise.resolve();
                }}
                onAssignmentsChange={handleAssignmentsChange}
                onVoteChange={handleVoteChange}
                onSmartZiwSearch={handleSmartZiwSearch}
            />

            <SyncPanel open={syncOpen} onClose={() => setSyncOpen(false)} onSyncDone={handleSyncDone} onSyncStart={snapshotBeforeSync} apiFetch={apiFetch} />
            <DemoWalkthrough open={demoOpen} onClose={() => setDemoOpen(false)} steps={DEMO_STEPS} />
            <ConfigPanel open={configOpen} onClose={() => setConfigOpen(false)} apiFetch={apiFetch} />
            <SchedulePanel open={scheduleOpen} onClose={() => setScheduleOpen(false)} apiFetch={apiFetch} />
            <ReleaseNotesModal
                open={releaseNotesOpen}
                releases={modalReleaseNotes}
                onClose={closeReleaseNotes}
                onOpenFull={() => {
                    closeReleaseNotes();
                    navigate('release-notes');
                }}
            />
            <NotificationsPanel
                open={notificationsOpen}
                notifications={groupedNotifications}
                unreadCount={unreadNotificationCount}
                onClose={() => setNotificationsOpen(false)}
                onOpenNotification={openProjectFromNotification}
                onMarkAllRead={markAllNotificationsAsRead}
            />
            <CommandDialog open={commandOpen} onOpenChange={setCommandOpen}>
                <CommandInput placeholder="Type a command or search…" />
                <CommandList>
                    <CommandEmpty>No results found.</CommandEmpty>
                    <CommandGroup heading="Navigation">
                        {NAV_GROUPS.filter((group) => !group.adminOnly || authUser?.role === 'admin').flatMap((group) => group.items).map((item) => (
                            <CommandItem
                                key={item.key}
                                onSelect={() => {
                                    setCommandOpen(false);
                                    navigate(item.key);
                                }}
                            >
                                <item.icon />
                                <span>{item.label}</span>
                            </CommandItem>
                        ))}
                    </CommandGroup>
                    <CommandGroup heading="Search">
                        <CommandItem
                            onSelect={() => {
                                setCommandOpen(false);
                                navigate('tenders');
                                focusTenderSearch();
                            }}
                        >
                            <Search />
                            <span>Search tenders</span>
                        </CommandItem>
                    </CommandGroup>
                </CommandList>
            </CommandDialog>
        </div>
    );
}
