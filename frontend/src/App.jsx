
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import TendersPage from './pages/TendersPage';
import TenderDetailPage from './pages/TenderDetailPage';
import ErrorBoundary from './components/ErrorBoundary';
import PageHeader from './components/PageHeader';
import { usePageHeader } from './components/PageHeaderContext';
import SectionCard from './components/SectionCard';
import DemoWalkthrough from './components/DemoWalkthrough';
import SyncPanel from './components/SyncPanel';
import SettingsPage from './components/SettingsPage';
import SchedulePage from './components/SchedulePage';
import Sidebar, { Avatar, NAV_GROUPS } from './components/Sidebar';
import AnalyticsPage from './components/AnalyticsPage';
import { Search, Bell, RefreshCw, User, Shield, Settings, CalendarClock, LogOut, Mail, Lock, X, Paperclip, Send, ArrowUp, ArrowDown, ArrowUpDown, MoreVertical, PenLine, KeyRound, UserCheck, UserX, ChevronDown, CircleHelp, Link, Trash2, SunMoon } from 'lucide-react';
import { SidebarProvider } from '@/components/ui/sidebar';
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button as ShadcnButton } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input as ShadcnInput } from '@/components/ui/input';
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { setModalScrollLock } from './utils/scrollLock';
import {
    getTenderIdFromHash,
    buildTenderHash,
    buildFullPageHash,
    isTenderFullPageHash,
    buildTenderShareUrl,
    buildDashboardHash,
    deserializeFilters,
} from './utils/tenderRouting';
import { attachProjectRowIds } from './utils/projects';
import { isRequired, isEmail, isUrl, isNumberInRange, matchesPassword } from './utils/validation';
import { useTheme } from './components/ThemeProvider';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { Avatar as ShadcnAvatar, AvatarFallback } from '@/components/ui/avatar';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

const LLM_PROVIDER_LOGOS = {
    openai: 'https://cdn.simpleicons.org/openai',
    anthropic: 'https://cdn.simpleicons.org/anthropic',
    gemini: 'https://cdn.simpleicons.org/google',
    groq: 'https://cdn.simpleicons.org/groq',
    together: 'https://cdn.simpleicons.org/togetherai',
    openrouter: 'https://cdn.simpleicons.org/openrouter',
    deepseek: 'https://cdn.simpleicons.org/deepseek',
    deepseek_api: 'https://cdn.simpleicons.org/deepseek',
    zai: 'https://cdn.simpleicons.org/zhipu',
    kimi: 'https://cdn.simpleicons.org/moonshotai',
};

const LLM_PROVIDER_COLORS = {
    openai: '#412991',
    anthropic: '#D97757',
    gemini: '#4285F4',
    groq: '#F55036',
    together: '#0F6FFF',
    openrouter: '#111827',
    deepseek: '#4D6BFA',
    deepseek_api: '#4D6BFA',
    zai: '#1A1A1A',
    kimi: '#007FFF',
    local: '#6B7280',
    custom: '#9CA3AF',
    auto: '#9CA3AF',
};

function ProviderLogo({ id, name, className = '' }) {
    const [failed, setFailed] = useState(false);
    const url = LLM_PROVIDER_LOGOS[id];
    const initials = useMemo(() => {
        const parts = (name || id || '?').split(/[\s()]+/).filter(Boolean);
        return parts.slice(0, 2).map((s) => s[0]).join('').toUpperCase();
    }, [name, id]);
    const color = LLM_PROVIDER_COLORS[id] || '#6B7280';
    if (failed || !url) {
        return (
            <span
                className={`inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ${className}`}
                style={{ backgroundColor: color }}
                aria-hidden="true"
            >
                {initials}
            </span>
        );
    }
    return (
        <img
            src={url}
            alt=""
            className={`h-5 w-5 flex-shrink-0 object-contain ${className}`}
            onError={() => setFailed(true)}
            aria-hidden="true"
        />
    );
}

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
            'Added admin settings for the research toggle, time limit, and Firecrawl MCP server support.',
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

const ADMIN_ROUTES = ['admin', 'users', 'smart-ziw', 'llm-config', 'skills', 'mcp-servers', 'system-prompts'];

const DEMO_STEPS = [
    { target: '.app-top-header', title: 'Page title and actions', body: 'The current page title, context, and primary action live in the compact top bar next to notifications, sync, and your account.' },
    { target: '.tender-stats-cards', title: 'Overview stats', body: 'Quick totals for tenders, new this week, pending review, and deadlines expiring soon.' },
    { target: '.tender-filter-bar', title: 'Filter bar', body: 'Narrow the list by source, region, deadline, or scrape date. Saved searches let you reuse common filters.' },
    { target: '.app-table tbody tr:first-child', title: 'Tender rows', body: 'Click any row to open a side sheet with the full analysis, discussion, and next actions.' },
    { target: '.tender-decision-buttons', title: 'Decision buttons', body: 'Managers can set the formal Go / No Go / Undecided verdict for a tender.' },
    { target: '.tender-comment-composer', title: 'Discussion', body: 'Post comments, attach files, and mention teammates with @. Use @SmartZiw to ask the agent follow-up questions.' },
    { target: '.project-inspector-actions button', title: 'Smart-Ziw agent', body: 'Run a full AI analysis on a tender. The agent researches the project and writes a structured recommendation.' },
    { target: '.admin-sidebar', title: 'Admin settings', body: 'Admins can manage users, release notes, agent configuration, tool API keys, LLM providers, and the tender classifier from the sidebar.' },
];

function normalizeRoute(rawRoute = '') {
    const route = String(rawRoute || '').replace(/^#/, '').replace(/^\//, '');
    if (route === 'comments' || route === 'tenders' || route.startsWith('tenders/')) return 'dashboard';
    return route || 'dashboard';
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
        strong: 'text-success',
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
        <Card className={isLatest ? 'border-primary/40' : ''}>
            <CardHeader className={compact ? 'pb-2' : ''}>
                <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">v{note.version}</Badge>
                    {isLatest ? <Badge className="bg-primary text-primary-foreground">Latest</Badge> : null}
                </div>
                <CardTitle className="text-lg">{note.title}</CardTitle>
                <p className="text-sm text-muted-foreground">{note.summary}</p>
            </CardHeader>
            <CardContent className={compact ? 'pt-0' : ''}>
                <div className="flex flex-col gap-4">
                    {groups.map((group) => (
                        <div key={group.key}>
                            <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{group.label}</h4>
                            <ul className="flex flex-col gap-1.5">
                                {group.items.map((item) => (
                                    <li key={item} className="flex gap-2 text-sm leading-5 text-foreground">
                                        <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                                        <span>{item}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>
            </CardContent>
        </Card>
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
        <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
            <DialogContent className="max-h-[calc(100dvh-40px)] max-w-2xl gap-0 overflow-y-auto p-0 sm:max-w-2xl">
                <DialogHeader className="items-start border-b px-6 pt-6 pb-4 text-left">
                    <span className="mb-2 text-xs font-bold tracking-widest text-primary uppercase">App updated</span>
                    <DialogTitle>What&apos;s new in v{latest.version}</DialogTitle>
                    <DialogDescription>{latest.summary}</DialogDescription>
                </DialogHeader>
                <div className="flex flex-col gap-3.5 bg-muted/30 px-6 py-5">
                    {releases.map((note) => (
                        <ReleaseChangelogCard
                            key={note.version}
                            note={note}
                            isLatest={note.version === APP_RELEASE_VERSION}
                            compact
                        />
                    ))}
                </div>
                <DialogFooter className="border-t px-6 py-4 sm:justify-between">
                    <ShadcnButton type="button" variant="ghost" onClick={onOpenFull}>
                        View full release notes
                    </ShadcnButton>
                    <ShadcnButton type="button" onClick={onClose}>
                        Continue
                    </ShadcnButton>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function ReleaseNotesPage({ releases, onBack }) {
    const { setPageHeader, clearPageHeader } = usePageHeader();

    useEffect(() => {
        setPageHeader({
            title: 'Release Notes',
            subtitle: 'Track major platform updates and newly delivered capabilities.',
            action: <ShadcnButton type="button" variant="outline" onClick={onBack}>Back</ShadcnButton>,
        });
        return () => clearPageHeader();
    }, [setPageHeader, clearPageHeader, onBack]);

    return (
        <div className="mx-auto w-full max-w-3xl">
            <div className="flex flex-col gap-4">
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
        <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4 flex-none">
            <path d="M10 15.5V5.5M10 5.5l-4 4M10 5.5l4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

function VoteDownIcon() {
    return (
        <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4 flex-none">
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
        <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
            <DialogContent className="max-w-md gap-0 p-0 sm:max-w-md">
                <DialogHeader className="border-b p-5 text-left">
                    <DialogTitle>Notifications</DialogTitle>
                    <DialogDescription>{unreadCount} unread</DialogDescription>
                </DialogHeader>
                <div className="max-h-[60vh] overflow-y-auto px-5 py-4">
                    {notifications.length ? notifications.map((item) => (
                        <button
                            key={item.id}
                            type="button"
                            className={`mb-2.5 w-full rounded-lg border p-3 text-left transition-colors ${item.read ? 'border-border bg-secondary opacity-80 hover:opacity-100' : 'border-l-4 border-primary bg-muted shadow-sm'} ${item.viewed ? '' : 'shadow-[inset_3px_0_0_var(--color-primary)]'}`}
                            onClick={() => onOpenNotification(item)}
                        >
                            <div className="flex flex-col gap-1">
                                <strong className={`text-sm ${item.read ? 'font-medium text-muted-foreground' : 'font-semibold text-foreground'}`}>{item.message}</strong>
                                <span className="text-xs text-muted-foreground">{formatDisplayDate(item.createdAt)}</span>
                            </div>
                        </button>
                    )) : <p className="text-sm text-muted-foreground">No notifications yet.</p>}
                </div>
                <DialogFooter className="border-t px-5 py-4">
                    <ShadcnButton type="button" variant="outline" onClick={onClose}>Close</ShadcnButton>
                    <ShadcnButton type="button" onClick={onMarkAllRead} disabled={!unreadCount}>Mark all read</ShadcnButton>
                </DialogFooter>
            </DialogContent>
        </Dialog>
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

    const { setPageHeader, clearPageHeader } = usePageHeader();

    useEffect(() => {
        setPageHeader({
            title: 'Profile settings',
            subtitle: 'Manage your personal information and account security.',
        });
        return () => clearPageHeader();
    }, [setPageHeader, clearPageHeader]);

    const saveProfile = async () => {
        const emailError = isEmail(email.trim());
        if (emailError) {
            toast.error(emailError);
            return;
        }
        setSavingProfile(true);
        try {
            const res = await apiFetch('/api/auth/profile', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, email, avatarUrl }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || 'Failed to update profile');
            onUserUpdate(data.user);
            toast.success('Profile updated.');
        } catch (err) {
            toast.error(err?.message || 'Failed to update profile');
        } finally {
            setSavingProfile(false);
        }
    };

    const savePassword = async () => {
        if (!currentPassword) {
            toast.error('Current password is required');
            return;
        }
        const matchError = matchesPassword(newPassword, confirmPassword);
        if (matchError) {
            toast.error(matchError);
            return;
        }
        setSavingPassword(true);
        try {
            const res = await apiFetch('/api/auth/change-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ currentPassword, newPassword }),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.detail || 'Failed to update password');
            }
            setCurrentPassword('');
            setNewPassword('');
            setConfirmPassword('');
            toast.success('Password updated.');
        } catch (err) {
            toast.error(err?.message || 'Failed to update password');
        } finally {
            setSavingPassword(false);
        }
    };

    return (
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">

            <div className="flex flex-col gap-6">
                <Card>
                    <CardContent className="flex flex-col gap-6 p-6">
                        <div className="flex items-center gap-4 max-sm:flex-col max-sm:items-start">
                            <div className="shrink-0">
                                <Avatar user={user} size={76} />
                            </div>
                            <div className="flex min-w-0 flex-col items-start gap-1.5">
                                <h2 className="text-2xl leading-tight font-bold tracking-tight text-foreground">{name}</h2>
                                <div className="flex flex-wrap items-center gap-2.5">
                                    <span className={`inline-flex min-h-7 items-center gap-1 rounded-full px-2.5 text-xs font-bold ${user?.role === 'admin' ? 'border border-primary/20 bg-primary/10 text-primary' : user?.role === 'manager' ? 'border border-primary/20 bg-primary/10 text-primary' : 'border border-border bg-secondary text-secondary-foreground'}`}>
                                        {user?.role === 'admin' ? 'Admin' : user?.role === 'manager' ? 'Manager' : 'User'}
                                    </span>
                                    <span className={`inline-flex items-center gap-1.5 text-[13px] font-semibold ${user?.isActive !== false ? 'text-success' : 'text-muted-foreground'}`}>
                                        <span className="size-2 rounded-full bg-current opacity-90" />
                                        {user?.isActive !== false ? 'Active' : 'Inactive'}
                                    </span>
                                </div>
                                <p className="max-w-full break-words text-sm text-muted-foreground">{email || 'No email address'}</p>
                            </div>
                        </div>

                        <dl className="m-0 grid grid-cols-3 gap-4 border-t border-border pt-5 max-sm:grid-cols-1">
                            <div className="flex min-w-0 flex-col gap-1">
                                <dt className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Joined</dt>
                                <dd className="m-0 text-sm font-bold text-foreground">{formatDate(user?.createdAt)}</dd>
                            </div>
                            <div className="flex min-w-0 flex-col gap-1">
                                <dt className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Last updated</dt>
                                <dd className="m-0 text-sm font-bold text-foreground">{formatDate(user?.updatedAt)}</dd>
                            </div>
                            <div className="flex min-w-0 flex-col gap-1">
                                <dt className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Email domain</dt>
                                <dd className="m-0 text-sm font-bold text-foreground">{emailDomain}</dd>
                            </div>
                        </dl>

                        <div className="flex items-start justify-between gap-4 border-b border-border pb-4">
                            <div>
                                <h3 className="text-lg font-bold">Personal information</h3>
                                <p className="mt-1.5 text-sm text-muted-foreground">Update your account details.</p>
                            </div>
                        </div>

                        <form
                            onSubmit={(event) => {
                                event.preventDefault();
                                saveProfile();
                            }}
                        >
                            <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
                                <div className="flex flex-col gap-1.5">
                                    <label className="text-[13px] font-semibold text-muted-foreground" htmlFor="prof-firstname">First name</label>
                                    <ShadcnInput id="prof-firstname" name="firstName" className="h-10" placeholder="First name" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                                </div>
                                <div className="flex flex-col gap-1.5">
                                    <label className="text-[13px] font-semibold text-muted-foreground" htmlFor="prof-lastname">Last name</label>
                                    <ShadcnInput id="prof-lastname" name="lastName" className="h-10" placeholder="Last name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
                                </div>
                                <div className="col-span-2 flex flex-col gap-1.5 max-sm:col-span-1">
                                    <label className="text-[13px] font-semibold text-muted-foreground" htmlFor="prof-email">Email</label>
                                    <ShadcnInput id="prof-email" name="email" className="h-10" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
                                </div>
                            </div>

                            <div className="flex items-center justify-end gap-3 border-t border-border pt-4">
                                <ShadcnButton type="submit" disabled={savingProfile}>{savingProfile ? 'Saving...' : 'Save changes'}</ShadcnButton>
                            </div>
                        </form>
                    </CardContent>
                </Card>

                <Card>
                    <CardContent className="flex flex-col gap-6 p-6">
                        <div className="flex items-start justify-between gap-4 border-b border-border pb-4">
                            <div>
                                <h3 className="text-lg font-bold">Preferences</h3>
                                <p className="mt-1.5 text-sm text-muted-foreground">Choose how your public profile appears to others.</p>
                            </div>
                        </div>

                        <form
                            onSubmit={(event) => {
                                event.preventDefault();
                                saveProfile();
                            }}
                        >
                            <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
                                <div className="col-span-2 flex flex-col gap-1.5 max-sm:col-span-1">
                                    <label className="text-[13px] font-semibold text-muted-foreground" htmlFor="prof-avatar">Profile photo URL</label>
                                    <ShadcnInput id="prof-avatar" name="avatarUrl" className="h-10" placeholder="https://..." value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} />
                                    <span className="text-[13px] text-muted-foreground">Use a direct image link to update the profile photo preview.</span>
                                </div>
                            </div>

                            <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
                                <ShadcnButton type="button" variant="outline" onClick={() => setAvatarUrl('')}>Remove avatar</ShadcnButton>
                                <ShadcnButton type="submit" disabled={savingProfile}>{savingProfile ? 'Saving...' : 'Save changes'}</ShadcnButton>
                            </div>
                        </form>
                    </CardContent>
                </Card>

                <Card>
                    <CardContent className="flex flex-col gap-6 p-6">
                        <div className="flex items-start justify-between gap-4 border-b border-border pb-4">
                            <div>
                                <h3 className="text-lg font-bold">Security</h3>
                                <p className="mt-1.5 text-sm text-muted-foreground">Change your password and keep your account secure.</p>
                            </div>
                        </div>

                        <form
                            onSubmit={(event) => {
                                event.preventDefault();
                                if (savingPassword || !currentPassword || !newPassword || passwordMismatch) return;
                                savePassword();
                            }}
                        >
                            <div className="flex flex-col gap-4">
                                <div className="flex flex-col gap-1.5">
                                    <label className="text-[13px] font-semibold text-muted-foreground" htmlFor="prof-curpwd">Current password</label>
                                    <ShadcnInput id="prof-curpwd" name="currentPassword" className="h-10" type="password" placeholder="Current password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
                                </div>
                                <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
                                    <div className="flex flex-col gap-1.5">
                                        <label className="text-[13px] font-semibold text-muted-foreground" htmlFor="prof-newpwd">New password</label>
                                        <ShadcnInput id="prof-newpwd" name="newPassword" className="h-10" type="password" placeholder="New password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
                                        <span className="text-[13px] text-muted-foreground">Minimum 8 characters.</span>
                                    </div>
                                    <div className="flex flex-col gap-1.5">
                                        <label className="text-[13px] font-semibold text-muted-foreground" htmlFor="prof-confirmpwd">Confirm new password</label>
                                        <ShadcnInput id="prof-confirmpwd" name="confirmPassword" className="h-10" type="password" placeholder="Confirm new password" autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
                                        {passwordMismatch ? <span className="text-[13px] text-destructive">Passwords do not match.</span> : <span className="text-[13px] text-muted-foreground">Re-enter the new password to confirm it.</span>}
                                    </div>
                                </div>
                            </div>

                            <div className="flex items-center justify-end gap-3 border-t border-border pt-4">
                                <ShadcnButton
                                    type="submit"
                                    disabled={savingPassword || !currentPassword || !newPassword || passwordMismatch}
                                >
                                    {savingPassword ? 'Saving...' : 'Update password'}
                                </ShadcnButton>
                            </div>
                        </form>
                    </CardContent>
                </Card>
            </div>
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
    const [errors, setErrors] = useState({});

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
        setErrors({});
    }, [open, initialUser]);

    useEffect(() => {
        if (!open) return undefined;
        setModalScrollLock(true);
        return () => setModalScrollLock(false);
    }, [open]);

    if (!open) return null;

    return (
        <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{mode === 'create' ? 'Create User' : 'Edit User'}</DialogTitle>
                    <DialogDescription className="sr-only">{mode === 'create' ? 'Create a new user account' : 'Edit user account details'}</DialogDescription>
                </DialogHeader>

                <form
                    onSubmit={(event) => {
                        event.preventDefault();
                        const fullName = `${firstName} ${lastName}`.trim();
                        const nextErrors = {};
                        const nameError = isRequired(fullName);
                        if (nameError) nextErrors.name = nameError;
                        const emailError = isEmail(email.trim());
                        if (emailError) nextErrors.email = emailError;
                        if (mode === 'create' && tempPassword && tempPassword.length < 8) {
                            nextErrors.password = 'Password must be at least 8 characters';
                        }
                        if (Object.keys(nextErrors).length) {
                            setErrors(nextErrors);
                            return;
                        }
                        setErrors({});
                        onSave({
                            name: fullName,
                            email: email.trim(),
                            role,
                            avatarUrl,
                            password: tempPassword,
                            isActive,
                        });
                    }}
                    className="flex flex-col gap-4"
                >
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div className="flex flex-col gap-2">
                            <Label htmlFor="ud-first">First name</Label>
                            <ShadcnInput id="ud-first" name="firstName" placeholder="First name" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                        </div>
                        <div className="flex flex-col gap-2">
                            <Label htmlFor="ud-last">Last name</Label>
                            <ShadcnInput id="ud-last" name="lastName" placeholder="Last name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
                        </div>
                        {errors.name ? <p className="col-span-full text-xs text-destructive">{errors.name}</p> : null}
                    </div>

                    <div className="flex flex-col gap-2">
                        <Label htmlFor="ud-email">Email</Label>
                        <ShadcnInput id="ud-email" name="email" type="email" placeholder="user@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
                        {errors.email ? <p className="text-xs text-destructive">{errors.email}</p> : null}
                    </div>

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div className="flex flex-col gap-2">
                            <Label htmlFor="ud-role">Role</Label>
                            <Select value={role} onValueChange={(value) => setRole(value)}>
                                <SelectTrigger id="ud-role" className="w-full"><SelectValue placeholder="Select role" /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="user">User</SelectItem>
                                    <SelectItem value="manager">Manager</SelectItem>
                                    <SelectItem value="admin">Admin</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="flex flex-col gap-2">
                            <Label htmlFor="ud-active">Status</Label>
                            <div className="flex h-9 items-center gap-2">
                                <Switch id="ud-active" checked={isActive} onCheckedChange={setIsActive} />
                                <span className="text-sm text-muted-foreground">{isActive ? 'Active' : 'Disabled'}</span>
                            </div>
                        </div>
                    </div>

                    <div className="flex flex-col gap-2">
                        <Label htmlFor="ud-avatar">Avatar URL</Label>
                        <ShadcnInput id="ud-avatar" name="avatarUrl" placeholder="https://..." value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} />
                    </div>

                    {mode === 'create' && (
                        <div className="flex flex-col gap-2">
                            <Label htmlFor="ud-pwd">Temporary password <span className="font-normal text-muted-foreground">(optional, auto-generated if empty)</span></Label>
                            <ShadcnInput id="ud-pwd" name="temporaryPassword" type="password" placeholder="Temporary password" autoComplete="new-password" value={tempPassword} onChange={(e) => setTempPassword(e.target.value)} />
                            {errors.password ? <p className="text-xs text-destructive">{errors.password}</p> : null}
                        </div>
                    )}

                    <DialogFooter className="mt-2">
                        <ShadcnButton type="button" variant="outline" onClick={onClose}>Cancel</ShadcnButton>
                        <ShadcnButton
                            type="submit"
                            disabled={saving}
                        >
                            {saving ? 'Saving...' : mode === 'create' ? 'Create User' : 'Save Changes'}
                        </ShadcnButton>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

function ResetPasswordModal({ open, user, onClose, onReset, saving, result }) {
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    useEffect(() => { if (open) { setPassword(''); setError(''); } }, [open]);
    useEffect(() => {
        if (!open) return undefined;
        setModalScrollLock(true);
        return () => setModalScrollLock(false);
    }, [open]);
    if (!open || !user) return null;

    return (
        <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
            <DialogContent className="sm:max-w-sm">
                <DialogHeader>
                    <DialogTitle>Reset Password</DialogTitle>
                    <DialogDescription className="sr-only">Set a new password for {user.name || user.email}</DialogDescription>
                </DialogHeader>
                <form
                    onSubmit={(event) => {
                        event.preventDefault();
                        if (password && password.length < 8) {
                            setError('Password must be at least 8 characters');
                            return;
                        }
                        setError('');
                        onReset(password || null);
                    }}
                    className="flex flex-col gap-4"
                >
                    <p className="m-0 text-sm text-muted-foreground">
                        Reset password for <strong className="font-semibold text-foreground">{user.name || user.email}</strong>
                    </p>
                    <div className="flex flex-col gap-2">
                        <Label htmlFor="rp-pwd">New password <span className="font-normal text-muted-foreground">(leave empty to auto-generate)</span></Label>
                        <ShadcnInput id="rp-pwd" name="resetPassword" type="password" placeholder="Auto-generated if empty" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
                        {error ? <p className="text-xs text-destructive">{error}</p> : null}
                    </div>
                    {result && <p className="text-sm text-primary">{result}</p>}
                    <DialogFooter className="mt-2">
                        <ShadcnButton type="button" variant="outline" onClick={onClose}>Cancel</ShadcnButton>
                        <ShadcnButton type="submit" disabled={saving}>
                            {saving ? 'Resetting...' : 'Reset Password'}
                        </ShadcnButton>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

function AdminPage({ apiFetch, authUser, initialTab = 'users', projects = [] }) {
    const [adminTab, setAdminTab] = useState(initialTab);
    const [users, setUsers] = useState([]);
    const [q, setQ] = useState('');
    const [roleFilter, setRoleFilter] = useState('all');
    const [statusFilter, setStatusFilter] = useState('all');
    const [drawer, setDrawer] = useState({ open: false, mode: 'create', user: null });
    const [savingDrawer, setSavingDrawer] = useState(false);
    const [refreshingUsers, setRefreshingUsers] = useState(false);
    const [resettingUserId, setResettingUserId] = useState('');
    const [togglingUserId, setTogglingUserId] = useState('');
    const [resetModal, setResetModal] = useState({ open: false, user: null });
    const [resetResult, setResetResult] = useState('');
    const [createResult, setCreateResult] = useState('');
    const [deleteModal, setDeleteModal] = useState({ open: false, user: null });
    const [deletingUserId, setDeletingUserId] = useState('');
    const [toggleModal, setToggleModal] = useState({ open: false, user: null });
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
        smart_ziw_research_enabled: true,
        smart_ziw_research_timeout_seconds: 900,
        smart_ziw_llm_provider: 'auto',
        lightllm_base_url: '',
        lightllm_api_key: '',
        lightllm_subscription_key: '',
        lightllm_model: 'default',
        lightllm_provider: 'openai_compatible',
        llm_temperature: 0.1,
        llm_max_tokens: 4000,
        tempmail_enabled: false,
        ai_verification_system_prompt: '',
        ai_verification_expertise: '',
        ai_verification_unwanted: '',
        auto_analyze_enabled: false,
        auto_analyze_sources: [],
        auto_analyze_countries: [],
        auto_analyze_max_per_run: 10,
    });
    const autoAnalyzeSourceOptions = useMemo(() => [...new Set(projects.flatMap((p) => String(p.source || '').split(',').map((s) => s.trim())).filter(Boolean))].sort(), [projects]);
    const autoAnalyzeCountryOptions = useMemo(() => [...new Set(projects.map((p) => p.country || p.primary_country_name_en).filter(Boolean))].sort(), [projects]);
    const [savingSmartZiwConfig, setSavingSmartZiwConfig] = useState(false);
    const [savingSystemPrompts, setSavingSystemPrompts] = useState(false);
    const [mcpServers, setMcpServers] = useState([]);
    const [mcpServersLoading, setMcpServersLoading] = useState(false);
    const [editingMcpId, setEditingMcpId] = useState('');
    const [mcpForm, setMcpForm] = useState({
        id: '',
        name: '',
        transport: 'sse',
        url: '',
        headersText: '',
        enabled: true,
        timeout: 30,
        tools: [],
    });
    const [mcpSaving, setMcpSaving] = useState(false);
    const [mcpTesting, setMcpTesting] = useState(false);
    const [mcpTestResult, setMcpTestResult] = useState(null);
    const [builtinMcpKeys, setBuiltinMcpKeys] = useState({});
    const [builtinMcpSavingId, setBuiltinMcpSavingId] = useState('');
    const [testingLlm, setTestingLlm] = useState(false);
    const [configErrors, setConfigErrors] = useState({});
    const [releaseErrors, setReleaseErrors] = useState({});
    const [mcpErrors, setMcpErrors] = useState({});
    const llmEnvProvider = smartZiwConfig.smart_ziw_llm_provider === 'deepseek';
    const llmDiscoverySeq = useRef(0);
    const [llmModels, setLlmModels] = useState({ status: 'idle', models: [], detail: null });
    const [llmModelsLoading, setLlmModelsLoading] = useState(false);
    const [llmProviders, setLlmProviders] = useState([]);
    const [llmProvidersLoading, setLlmProvidersLoading] = useState(false);
    const [llmEnvStatus, setLlmEnvStatus] = useState({ model: '', api_key_set: false });
    const [llmStatus, setLlmStatus] = useState(null);
    const { setPageHeader, clearPageHeader } = usePageHeader();

    const adminSubtitles = {
        users: 'Create, edit, deactivate users, and reset passwords.',
        'release-notes': 'Create new release notes or update existing versions.',
        'smart-ziw': 'Configure the Smart-Ziw agent and optional GitLab push.',
        'mcp-servers': 'API keys for the built-in tools, plus external MCP servers.',
        llm: 'Configure the LLM backend used by the Smart-Ziw agent.',
        'system-prompts': 'Tune the tender classifier that flags cybersecurity-relevant tenders.',
    };

    useEffect(() => {
        const getAction = () => {
            if (adminTab === 'users') {
                return (
                    <ShadcnButton
                        type="button"
                        disabled={savingDrawer}
                        onClick={() => setDrawer({ open: true, mode: 'create', user: null })}
                    >
                        Create user
                    </ShadcnButton>
                );
            }
            if (adminTab === 'release-notes') {
                return (
                    <ShadcnButton
                        type="button"
                        disabled={savingReleaseNotes}
                        onClick={startNewReleaseNote}
                    >
                        New release note
                    </ShadcnButton>
                );
            }
            if (adminTab === 'mcp-servers') {
                return (
                    <ShadcnButton
                        type="button"
                        onClick={() => {
                            resetMcpForm();
                            setTimeout(() => document.getElementById('mcp-name')?.focus(), 0);
                        }}
                    >
                        Add server
                    </ShadcnButton>
                );
            }
            return null;
        };
        setPageHeader({
            title: 'Admin',
            subtitle: 'Manage users, agent settings, and platform configuration.',
            action: getAction(),
        });
        return () => clearPageHeader();
    }, [adminTab, savingDrawer, savingReleaseNotes, setPageHeader, clearPageHeader]);

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
            const { llm_status, ...rest } = data || {};
            setSmartZiwConfig((prev) => ({ ...prev, ...rest }));
            if (llm_status) setLlmStatus(llm_status);
        }
    }, [apiFetch]);

    const loadMcpServers = useCallback(async () => {
        setMcpServersLoading(true);
        try {
            const res = await apiFetch('/api/admin/smart-ziw-mcp-servers');
            if (!res.ok) throw new Error('Failed to load MCP servers');
            const data = await res.json();
            setMcpServers(Array.isArray(data) ? data : []);
        } catch (error) {
            toast.error(`Failed to load MCP servers: ${error?.message || 'unknown error'}`);
        } finally {
            setMcpServersLoading(false);
        }
    }, [apiFetch]);

    const discoverLlmModels = useCallback(async (presetId, baseUrl, apiKey, subscriptionKey) => {
        const seq = ++llmDiscoverySeq.current;
        setLlmModelsLoading(true);
        setLlmModels({ status: 'loading', models: [], detail: null });
        try {
            const res = await apiFetch('/api/admin/llm-models', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ preset_id: presetId, base_url: baseUrl || '', api_key: apiKey || '', subscription_key: subscriptionKey || '' }),
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
        const preset = llmProviders.find((p) => p.id === smartZiwConfig.smart_ziw_llm_provider);
        if (llmEnvProvider || !preset || preset.format !== 'openai' || !preset.base_url) {
            setLlmModels({ status: 'idle', models: [], detail: null });
            setLlmModelsLoading(false);
            return;
        }
        const effectiveUrl = smartZiwConfig.lightllm_base_url.trim() || preset.base_url;
        discoverLlmModels(preset.id, effectiveUrl, smartZiwConfig.lightllm_api_key, smartZiwConfig.lightllm_subscription_key);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [adminTab, smartZiwConfig.smart_ziw_llm_provider, llmProviders]);

    useEffect(() => {
        if (adminTab !== 'llm') return;
        let cancelled = false;
        setLlmProvidersLoading(true);
        apiFetch('/api/admin/llm-providers')
            .then((res) => (res.ok ? res.json() : []))
            .then((data) => {
                if (!cancelled) setLlmProviders(Array.isArray(data) ? data : []);
            })
            .catch(() => {})
            .finally(() => {
                if (!cancelled) setLlmProvidersLoading(false);
            });
        return () => { cancelled = true; };
    }, [adminTab, apiFetch]);

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
        if (adminTab !== 'smart-ziw' && adminTab !== 'llm' && adminTab !== 'system-prompts') return;
        loadSmartZiwConfig();
    }, [adminTab, loadSmartZiwConfig]);

    useEffect(() => {
        if (adminTab !== 'mcp-servers') return;
        loadMcpServers();
    }, [adminTab, loadMcpServers]);

    const saveSmartZiwConfig = async () => {
        const nextErrors = {};
        if (smartZiwConfig.smart_ziw_enabled) {
            const repoError = isRequired(smartZiwConfig.smart_ziw_repo_path);
            if (repoError) nextErrors.smart_ziw_repo_path = repoError;
        }
        const timeoutError = isNumberInRange(smartZiwConfig.smart_ziw_research_timeout_seconds, 1, undefined);
        if (timeoutError) nextErrors.smart_ziw_research_timeout_seconds = timeoutError;
        if (Object.keys(nextErrors).length) {
            setConfigErrors(nextErrors);
            return;
        }
        setConfigErrors({});
        setSavingSmartZiwConfig(true);
        try {
            const res = await apiFetch('/api/admin/smart-ziw-config', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(smartZiwConfig),
            });
            if (!res.ok) throw new Error('Failed to save');
            const data = await res.json();
            const { llm_status, ...rest } = data || {};
            if (llm_status) setLlmStatus(llm_status);
            setSmartZiwConfig((prev) => ({ ...prev, ...rest, lightllm_api_key: '', forvis_mazars_presence_countries: data.forvis_mazars_presence_countries || prev.forvis_mazars_presence_countries }));
            toast.success('Smart-Ziw config saved.');
        } catch (error) {
            toast.error(`Failed to save Smart-Ziw config: ${error?.message || 'unknown error'}`);
        } finally {
            setSavingSmartZiwConfig(false);
        }
    };

    const saveSystemPrompts = async () => {
        setSavingSystemPrompts(true);
        try {
            const res = await apiFetch('/api/admin/smart-ziw-config', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(smartZiwConfig),
            });
            if (!res.ok) throw new Error('Failed to save');
            const data = await res.json();
            const { llm_status, ...rest } = data || {};
            if (llm_status) setLlmStatus(llm_status);
            setSmartZiwConfig((prev) => ({ ...prev, ...rest, lightllm_api_key: '', forvis_mazars_presence_countries: data.forvis_mazars_presence_countries || prev.forvis_mazars_presence_countries }));
            toast.success('Classifier saved.');
        } catch (error) {
            toast.error(`Failed to save classifier: ${error?.message || 'unknown error'}`);
        } finally {
            setSavingSystemPrompts(false);
        }
    };

    const testAndSaveLlmConfig = async () => {
        const nextErrors = {};
        const preset = llmProviders.find((p) => p.id === smartZiwConfig.smart_ziw_llm_provider);
        const needsBaseUrl = !llmEnvProvider && (smartZiwConfig.smart_ziw_llm_provider === 'local' || smartZiwConfig.smart_ziw_llm_provider === 'custom' || (preset && preset.format));
        if (needsBaseUrl) {
            const urlError = isUrl(smartZiwConfig.lightllm_base_url.trim() || preset?.base_url || '');
            if (urlError) nextErrors.lightllm_base_url = urlError;
        }
        const tempError = isNumberInRange(smartZiwConfig.llm_temperature, 0, 2);
        if (tempError) nextErrors.llm_temperature = tempError;
        const tokensError = isNumberInRange(smartZiwConfig.llm_max_tokens, 1, 128000);
        if (tokensError) nextErrors.llm_max_tokens = tokensError;
        if (Object.keys(nextErrors).length) {
            setConfigErrors(nextErrors);
            return;
        }
        setConfigErrors({});
        setSavingSmartZiwConfig(true);
        setTestingLlm(true);
        try {
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
                    toast.error('Not saved — the provider test failed. Fix the settings and try again.');
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

    const buildMcpPayload = () => {
        const headers = {};
        mcpForm.headersText
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
            .forEach((line) => {
                const idx = line.indexOf('=');
                if (idx <= 0) return;
                headers[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
            });
        return {
            id: mcpForm.id || '',
            name: mcpForm.name.trim(),
            transport: 'sse',
            url: mcpForm.url.trim(),
            headers,
            enabled: mcpForm.enabled,
            timeout: Number.isFinite(Number(mcpForm.timeout)) && Number(mcpForm.timeout) >= 1 ? Number(mcpForm.timeout) : 30,
            tools: mcpForm.tools || [],
        };
    };

    const resetMcpForm = () => {
        setEditingMcpId('');
        setMcpTestResult(null);
        setMcpForm({
            id: '',
            name: '',
            transport: 'sse',
            url: '',
            headersText: '',
            enabled: true,
            timeout: 30,
            tools: [],
        });
    };

    const startEditMcpServer = (server) => {
        setEditingMcpId(server.id || '');
        setMcpTestResult(null);
        setMcpForm({
            id: server.id || '',
            name: server.name || '',
            transport: 'sse',
            url: server.url || '',
            headersText: Object.entries(server.headers || {}).map(([key, value]) => `${key}=${value}`).join('\n'),
            enabled: server.enabled !== false,
            timeout: Number.isFinite(Number(server.timeout)) && Number(server.timeout) >= 1 ? Number(server.timeout) : 30,
            tools: server.tools || [],
        });
    };

    const testMcpServer = async () => {
        const nextErrors = {};
        const nameError = isRequired(mcpForm.name.trim());
        if (nameError) nextErrors.name = nameError;
        const urlError = isUrl(mcpForm.url.trim());
        if (urlError) nextErrors.url = urlError;
        if (Object.keys(nextErrors).length) {
            setMcpErrors(nextErrors);
            return;
        }
        setMcpErrors({});
        setMcpTesting(true);
        setMcpTestResult(null);
        try {
            const res = await apiFetch('/api/admin/smart-ziw-mcp-servers/test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(buildMcpPayload()),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || data?.status !== 'ok') {
                setMcpTestResult({ status: 'error', tools: [], detail: data?.detail || `Test failed (HTTP ${res.status})` });
                toast.error('MCP server test failed.');
                return;
            }
            setMcpTestResult({ status: 'ok', tools: data?.tools || [], detail: data?.detail || '' });
            setMcpForm((prev) => ({ ...prev, tools: data?.tools || [] }));
            toast.success(`Connected — discovered ${(data?.tools || []).length} tool(s).`);
        } catch (error) {
            setMcpTestResult({ status: 'error', tools: [], detail: `The test could not run: ${error?.message || 'unknown error'}` });
            toast.error('MCP server test failed.');
        } finally {
            setMcpTesting(false);
        }
    };

    const saveMcpServer = async () => {
        const nextErrors = {};
        const nameError = isRequired(mcpForm.name.trim());
        if (nameError) nextErrors.name = nameError;
        const urlError = isUrl(mcpForm.url.trim());
        if (urlError) nextErrors.url = urlError;
        if (Object.keys(nextErrors).length) {
            setMcpErrors(nextErrors);
            return;
        }
        setMcpErrors({});
        if (!mcpTestResult || mcpTestResult.status !== 'ok') {
            toast.error('Test the server connection first — it must pass before saving.');
            return;
        }
        setMcpSaving(true);
        try {
            const isEdit = Boolean(editingMcpId);
            const res = await apiFetch(
                isEdit ? `/api/admin/smart-ziw-mcp-servers/${encodeURIComponent(editingMcpId)}` : '/api/admin/smart-ziw-mcp-servers',
                {
                    method: isEdit ? 'PUT' : 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(buildMcpPayload()),
                }
            );
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.detail || `Save failed (HTTP ${res.status})`);
            }
            await loadMcpServers();
            resetMcpForm();
            toast.success(isEdit ? 'MCP server updated.' : 'MCP server added.');
        } catch (error) {
            toast.error(`Failed to save MCP server: ${error?.message || 'unknown error'}`);
        } finally {
            setMcpSaving(false);
        }
    };

    const deleteMcpServer = async (id) => {
        try {
            const res = await apiFetch(`/api/admin/smart-ziw-mcp-servers/${encodeURIComponent(id)}`, {
                method: 'DELETE',
            });
            if (!res.ok) throw new Error('Failed to delete MCP server');
            await loadMcpServers();
            if (editingMcpId === id) resetMcpForm();
            toast.success('MCP server deleted');
        } catch (error) {
            toast.error(`Failed to delete MCP server: ${error?.message || 'unknown error'}`);
        }
    };

    const toggleMcpServer = async (server) => {
        try {
            const res = await apiFetch(`/api/admin/smart-ziw-mcp-servers/${encodeURIComponent(server.id)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: server.id,
                    name: server.name,
                    transport: server.transport || 'sse',
                    url: server.url || '',
                    headers: server.headers || {},
                    enabled: !server.enabled,
                    timeout: server.timeout || 30,
                    tools: server.tools || [],
                }),
            });
            if (!res.ok) throw new Error('Failed to update MCP server');
            await loadMcpServers();
            toast.success(server.enabled ? 'MCP server disabled' : 'MCP server enabled');
        } catch (error) {
            toast.error(`Failed to update MCP server: ${error?.message || 'unknown error'}`);
        }
    };

    const saveBuiltinMcpKey = async (server) => {
        const key = (builtinMcpKeys[server.id] || '').trim();
        const headerName = server.api_key_header;
        if (!headerName) return;
        if (!key && !server.api_key_configured) {
            toast.error(`Enter the ${server.name} API key first.`);
            return;
        }
        setBuiltinMcpSavingId(server.id);
        try {
            // Redacted "***" values mean "unchanged" server-side; send the header
            // only when a new key was typed.
            const headers = {};
            if (key) headers[headerName] = `${server.api_key_prefix || ''}${key}`;
            const res = await apiFetch(`/api/admin/smart-ziw-mcp-servers/${encodeURIComponent(server.id)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: server.id,
                    name: server.name,
                    transport: server.transport || 'http',
                    url: server.url || '',
                    headers,
                    enabled: server.enabled !== false,
                    timeout: server.timeout || 30,
                    tools: server.tools || [],
                }),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.detail || `Save failed (HTTP ${res.status})`);
            }
            const data = await res.json().catch(() => ({}));
            setBuiltinMcpKeys((prev) => ({ ...prev, [server.id]: '' }));
            await loadMcpServers();
            if (data.test && data.test.status === 'error') {
                toast.warning(`${server.name} API key saved, but the connection test failed: ${data.test.detail || 'unknown error'}.`);
            } else {
                toast.success(`${server.name} API key saved.`);
            }
        } catch (error) {
            toast.error(`Failed to save ${server.name} API key: ${error?.message || 'unknown error'}`);
        } finally {
            setBuiltinMcpSavingId('');
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
            if (!res.ok) throw new Error((await res.json()).detail || 'Create failed');
            const data = await res.json();
            toast.success(`User created: ${data.user.email}`);
            setCreateResult(`Temporary password: ${data.temporaryPassword}`);
            setDrawer({ open: false, mode: 'create', user: null });
            loadUsers();
        } catch (err) {
            toast.error(err?.message || 'Failed to create user');
        } finally {
            setSavingDrawer(false);
        }
    };

    const saveUser = async (form) => {
        if (!drawer.user) return;
        if (drawer.user.id === authUser?.id && form.role !== 'admin') {
            toast.error('You cannot remove your own admin role.');
            return;
        }
        if (drawer.user.id === authUser?.id && !form.isActive) {
            toast.error('You cannot deactivate your own account.');
            return;
        }
        setSavingDrawer(true);
        try {
            const res = await apiFetch(`/api/admin/users/${drawer.user.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: form.name, email: form.email, role: form.role, avatarUrl: form.avatarUrl, isActive: form.isActive }),
            });
            if (!res.ok) throw new Error((await res.json()).detail || 'Save failed');
            toast.success('User saved');
            setDrawer({ open: false, mode: 'create', user: null });
            loadUsers();
        } catch (err) {
            toast.error(err?.message || 'Failed to save user');
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
            if (!res.ok) throw new Error((await res.json()).detail || 'Reset failed');
            const data = await res.json();
            setResetResult(`Temporary password: ${data.temporaryPassword}`);
            toast.success(`Password reset for ${resetModal.user.email}`);
        } catch (err) {
            toast.error(err?.message || 'Failed to reset password');
        } finally {
            setResettingUserId('');
        }
    };

    const promptToggleUser = (user) => {
        if (user.id === authUser?.id) {
            toast.error('You cannot deactivate your own account.');
            return;
        }
        setToggleModal({ open: true, user });
    };

    const confirmToggleUser = async () => {
        const user = toggleModal.user;
        if (!user) return;
        setTogglingUserId(user.id);
        try {
            const res = await apiFetch(`/api/admin/users/${user.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: user.name, email: user.email, role: user.role, avatarUrl: user.avatarUrl || '', isActive: !user.isActive }),
            });
            if (!res.ok) throw new Error((await res.json()).detail || 'Toggle failed');
            toast.success(user.isActive ? 'User deactivated' : 'User activated');
            setToggleModal({ open: false, user: null });
            loadUsers();
        } catch (err) {
            toast.error(err?.message || 'Failed to update user status');
        } finally {
            setTogglingUserId('');
        }
    };

    const promptDeleteUser = (user) => {
        if (user.id === authUser?.id) {
            toast.error('You cannot delete your own account.');
            return;
        }
        setDeleteModal({ open: true, user });
    };

    const deleteUser = async () => {
        if (!deleteModal.user) return;
        const user = deleteModal.user;
        setDeletingUserId(user.id);
        try {
            const res = await apiFetch(`/api/admin/users/${user.id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error((await res.json()).detail || 'Delete failed');
            toast.success(`Deleted ${user.email}`);
            setDeleteModal({ open: false, user: null });
            loadUsers();
        } catch (err) {
            toast.error(err?.message || 'Failed to delete user');
        } finally {
            setDeletingUserId('');
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
        const nextErrors = {};
        const versionError = isRequired(nextNote.version);
        if (versionError) nextErrors.version = versionError;
        const titleError = isRequired(nextNote.title);
        if (titleError) nextErrors.title = titleError;
        if (Object.keys(nextErrors).length) {
            setReleaseErrors(nextErrors);
            return;
        }
        setReleaseErrors({});
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
            toast.success('Release notes saved.');
        } catch (error) {
            toast.error(`Failed to save release notes: ${error?.message || 'unknown error'}`);
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
            toast.success('Release note deleted.');
        } catch (error) {
            toast.error(`Failed to delete release note: ${error?.message || 'unknown error'}`);
        } finally {
            setSavingReleaseNotes(false);
        }
    };

    return (
        <div className="mx-auto max-w-6xl">
            <div className="flex flex-col gap-8">
                <div className="flex flex-col gap-6">
                    <div className="flex flex-col gap-1">
                        <h1 className="text-3xl font-semibold tracking-tight">Admin</h1>
                        <p className="text-sm text-muted-foreground">Manage users, agent settings, and platform configuration.</p>
                    </div>

                    <nav aria-label="Admin sections" className="flex items-center gap-6 border-b">
                        {[
                            { id: 'users', label: 'Users' },
                            { id: 'release-notes', label: 'Release Notes' },
                            { id: 'smart-ziw', label: 'Agent' },
                            { id: 'mcp-servers', label: 'Tools' },
                            { id: 'llm', label: 'LLM Provider' },
                            { id: 'system-prompts', label: 'Classifier' },
                        ].map((tab) => {
                            const active = adminTab === tab.id;
                            return (
                                <button
                                    key={tab.id}
                                    type="button"
                                    onClick={() => setAdminTab(tab.id)}
                                    className={`relative pb-3 text-sm transition-colors ${active ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                                >
                                    {tab.label}
                                    {active ? <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full bg-foreground" /> : null}
                                </button>
                            );
                        })}
                    </nav>
                </div>

                <div className="min-w-0">

            {adminTab === 'users' ? (
            <section className="flex flex-col gap-8">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-3">
                        <div className="relative">
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <ShadcnInput
                                type="search"
                                placeholder="Search users..."
                                value={q}
                                onChange={handleSearchChange}
                                className="h-9 w-64 pl-10"
                                aria-label="Search users"
                            />
                        </div>
                        <Select value={roleFilter} onValueChange={(value) => setRoleFilter(value)}>
                            <SelectTrigger className="h-9 w-36" aria-label="Filter users by role"><SelectValue placeholder="All roles" /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All roles</SelectItem>
                                <SelectItem value="admin">Admin</SelectItem>
                                <SelectItem value="manager">Manager</SelectItem>
                                <SelectItem value="user">User</SelectItem>
                            </SelectContent>
                        </Select>
                        <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value)}>
                            <SelectTrigger className="h-9 w-36" aria-label="Filter users by status"><SelectValue placeholder="All status" /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All status</SelectItem>
                                <SelectItem value="active">Active</SelectItem>
                                <SelectItem value="disabled">Disabled</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="flex items-center gap-3">
                        <span className="text-sm text-muted-foreground">
                            <strong className="font-semibold text-foreground">{filteredUsers.length}</strong>{' '}
                            {filteredUsers.length === 1 ? 'user' : 'users'}
                        </span>
                        <ShadcnButton
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={loadUsers}
                            disabled={refreshingUsers}
                        >
                            {refreshingUsers ? 'Refreshing...' : 'Refresh'}
                        </ShadcnButton>
                    </div>
                </div>

                <div className="admin-stats-cards grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <div className="rounded-xl bg-muted/40 p-5">
                        <div className="flex flex-col gap-1.5">
                            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Total Users</span>
                            <span className="text-2xl font-semibold tracking-tight text-foreground">{users.length}</span>
                            <span className="text-xs text-muted-foreground">Accounts in the system</span>
                        </div>
                    </div>
                    <div className="rounded-xl bg-muted/40 p-5">
                        <div className="flex flex-col gap-1.5">
                            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Active Users</span>
                            <span className="text-2xl font-semibold tracking-tight text-foreground">{users.filter((u) => u.isActive).length}</span>
                            <span className="text-xs text-muted-foreground">Currently enabled</span>
                        </div>
                    </div>
                    <div className="rounded-xl bg-muted/40 p-5">
                        <div className="flex flex-col gap-1.5">
                            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Admins</span>
                            <span className="text-2xl font-semibold tracking-tight text-foreground">{users.filter((u) => u.role === 'admin').length}</span>
                            <span className="text-xs text-muted-foreground">Privileged accounts</span>
                        </div>
                    </div>
                </div>

                {createResult ? (
                    <div className="border-y border-border bg-primary/5 px-5 py-3 text-sm text-foreground/80 flex items-center justify-between gap-3">
                        <span>{createResult}</span>
                        <ShadcnButton type="button" variant="ghost" size="sm" onClick={() => setCreateResult('')}>Dismiss</ShadcnButton>
                    </div>
                ) : null}

                <div className="overflow-hidden rounded-lg border">
                <Table aria-label="Users table">
                    <TableHeader>
                        <TableRow className="hover:bg-transparent">
                            {columns.map((col) => (
                                <TableHead
                                    key={col.key}
                                    className={`${col.key === '_actions' ? 'w-12' : ''} ${col.type !== 'none' ? 'cursor-pointer select-none' : ''}`}
                                    aria-sort={sortCol === col.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}
                                    onClick={col.type !== 'none' ? () => handleSortChange({ column: col.key, direction: sortCol === col.key && sortDir === 'asc' ? 'descending' : 'ascending' }) : undefined}
                                >
                                    <span className="inline-flex items-center gap-1.5">
                                        {col.label}
                                        {col.type !== 'none' ? (
                                            sortCol === col.key
                                                ? (sortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)
                                                : <ArrowUpDown className="h-3 w-3 opacity-60" />
                                        ) : null}
                                    </span>
                                </TableHead>
                            ))}
                        </TableRow>
                    </TableHeader>

                    <TableBody>
                        {pageData.map((u) => (
                            <TableRow key={u.id} className={u.isActive ? '' : 'bg-muted/80 text-muted-foreground'}>
                                <TableCell>
                                    <div className="flex items-center gap-3">
                                        <Avatar user={u} size={40} />
                                        <span className="font-medium text-foreground">{u.name}</span>
                                    </div>
                                </TableCell>
                                <TableCell><span className="text-muted-foreground">{u.email}</span></TableCell>
                                <TableCell>
                                    <Badge variant="outline" className={u.role === 'admin' ? 'border-primary/20 bg-primary/10 text-primary' : 'bg-secondary text-secondary-foreground'}>
                                        {u.role === 'admin' ? 'Admin' : u.role === 'manager' ? 'Manager' : 'User'}
                                    </Badge>
                                </TableCell>
                                <TableCell>
                                    <Badge variant="outline" className={u.isActive ? 'gap-1 border-success/25 bg-success/10 text-success' : 'gap-1 bg-secondary text-secondary-foreground'}>
                                        <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
                                        {u.isActive ? 'Active' : 'Disabled'}
                                    </Badge>
                                </TableCell>
                                <TableCell><span className="text-muted-foreground">{formatAdminDateTime(u.lastSeenAt)}</span></TableCell>
                                <TableCell className="w-12 text-center">
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <ShadcnButton variant="ghost" size="icon-sm" className="h-8 w-8" aria-label={`Actions for ${u.name}`}>
                                                <MoreVertical className="h-4 w-4" />
                                            </ShadcnButton>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end" className="w-44">
                                            <DropdownMenuItem onSelect={() => setDrawer({ open: true, mode: 'edit', user: u })}>
                                                <PenLine className="mr-2 h-4 w-4" />Edit user
                                            </DropdownMenuItem>
                                            <DropdownMenuItem onSelect={() => { setResetResult(''); setResetModal({ open: true, user: u }); }}>
                                                <KeyRound className="mr-2 h-4 w-4" />{resettingUserId === u.id ? 'Resetting...' : 'Reset password'}
                                            </DropdownMenuItem>
                                            <DropdownMenuSeparator />
                                            <DropdownMenuItem onSelect={() => promptToggleUser(u)}>
                                                {u.isActive ? <UserX className="mr-2 h-4 w-4" /> : <UserCheck className="mr-2 h-4 w-4" />}
                                                {togglingUserId === u.id ? 'Updating...' : (u.isActive ? 'Deactivate' : 'Activate')}
                                            </DropdownMenuItem>
                                            <DropdownMenuSeparator />
                                            <DropdownMenuItem
                                                className="text-destructive focus:text-destructive"
                                                onSelect={() => promptDeleteUser(u)}
                                            >
                                                <Trash2 className="mr-2 h-4 w-4" />
                                                {deletingUserId === u.id ? 'Deleting...' : 'Delete user'}
                                            </DropdownMenuItem>
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
                </div>

                {pageData.length === 0 && (
                    <div className="py-12 text-center">
                        <h3 className="text-base font-semibold text-foreground">No users found</h3>
                        <p className="mt-1 text-sm text-muted-foreground">Try adjusting your search or filters</p>
                    </div>
                )}

                {sorted.length > 0 && (
                    <div className="flex flex-wrap items-center justify-between gap-3 border-t p-4">
                        <div className="text-sm text-muted-foreground">
                            Showing <strong className="font-semibold text-foreground">{startItem}-{endItem}</strong> of <strong className="font-semibold text-foreground">{sorted.length}</strong>
                        </div>
                        {totalPages > 1 ? (
                            <div className="flex items-center gap-1">
                                <ShadcnButton variant="outline" size="sm" className="px-2.5" disabled={page === 0} onClick={() => setPage(0)} title="First page">{'<<'}</ShadcnButton>
                                <ShadcnButton variant="outline" size="sm" className="px-2.5" disabled={page === 0} onClick={() => setPage(page - 1)} title="Previous page">{'<'}</ShadcnButton>
                                <span className="px-2 text-sm text-muted-foreground">
                                    Page <strong className="font-semibold text-foreground">{page + 1}</strong> of <strong className="font-semibold text-foreground">{totalPages}</strong>
                                </span>
                                <ShadcnButton variant="outline" size="sm" className="px-2.5" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)} title="Next page">{'>'}</ShadcnButton>
                                <ShadcnButton variant="outline" size="sm" className="px-2.5" disabled={page >= totalPages - 1} onClick={() => setPage(totalPages - 1)} title="Last page">{'>>'}</ShadcnButton>
                            </div>
                        ) : (
                            <div className="text-sm text-muted-foreground">Single page</div>
                        )}
                        <div className="flex items-center gap-2 text-sm">
                            <Label htmlFor="admin-rows-per-page" className="text-muted-foreground">Rows</Label>
                            <Select value={String(rowsPerPage)} onValueChange={(value) => { setRowsPerPage(Number(value)); setPage(0); }}>
                                <SelectTrigger id="admin-rows-per-page" className="h-8 w-20"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {[10, 25, 50].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                )}
            </section>
            ) : null}

            {adminTab === 'release-notes' ? (
                <section className="flex flex-col gap-6">
                    <div className="flex flex-col gap-1">
                        <h3 className="text-lg font-semibold tracking-tight text-foreground">Release Notes</h3>
                        <p className="text-sm text-muted-foreground">Create new release notes or update existing versions.</p>
                    </div>
                    <div className="grid gap-6 md:grid-cols-[240px_1fr]">
                        <aside className="flex flex-col gap-2">
                            {releaseNotes.map((note) => (
                                <button
                                    key={note.version}
                                    type="button"
                                    className={`flex flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors ${selectedReleaseVersion === note.version ? 'border-primary/40 bg-primary/5' : 'border-border bg-card hover:bg-muted'}`}
                                    onClick={() => setSelectedReleaseVersion(note.version)}
                                >
                                    <span className="text-xs font-semibold text-primary">v{note.version}</span>
                                    <strong className="text-sm font-medium text-foreground">{note.title}</strong>
                                </button>
                            ))}
                        </aside>
                        <div className="flex flex-col gap-6 rounded-xl border bg-card/50 p-6">
                            <div className="grid gap-4 sm:grid-cols-2">
                                <div className="flex flex-col gap-1.5">
                                    <Label htmlFor="release-version" className="text-sm font-medium">Version</Label>
                                    <ShadcnInput id="release-version" value={releaseForm.version} onChange={(e) => setReleaseForm((prev) => ({ ...prev, version: e.target.value }))} placeholder="1.3" />
                                    {releaseErrors.version ? <p className="text-xs text-destructive">{releaseErrors.version}</p> : null}
                                </div>
                                <div className="flex flex-col gap-1.5">
                                    <Label htmlFor="release-title" className="text-sm font-medium">Title</Label>
                                    <ShadcnInput id="release-title" value={releaseForm.title} onChange={(e) => setReleaseForm((prev) => ({ ...prev, title: e.target.value }))} placeholder="Release title" />
                                    {releaseErrors.title ? <p className="text-xs text-destructive">{releaseErrors.title}</p> : null}
                                </div>
                            </div>
                            <div className="flex flex-col gap-1.5">
                                <Label htmlFor="release-summary" className="text-sm font-medium">Summary</Label>
                                <ShadcnInput id="release-summary" value={releaseForm.summary} onChange={(e) => setReleaseForm((prev) => ({ ...prev, summary: e.target.value }))} placeholder="Short summary shown in the release modal" />
                            </div>
                            <div className="flex flex-col gap-1.5">
                                <Label htmlFor="release-items" className="text-sm font-medium">Items</Label>
                                <Textarea id="release-items" rows={6} value={releaseForm.itemsText} onChange={(e) => setReleaseForm((prev) => ({ ...prev, itemsText: e.target.value }))} placeholder="One bullet item per line" />
                            </div>
                            <div className="flex items-center justify-end gap-3 border-t pt-4">
                                <ShadcnButton type="button" variant="outline" disabled={savingReleaseNotes || selectedReleaseVersion === '__new__' || !selectedReleaseVersion} onClick={deleteReleaseNote}>Delete</ShadcnButton>
                                <ShadcnButton type="button" disabled={savingReleaseNotes} onClick={saveReleaseNotes}>
                                    {savingReleaseNotes ? 'Saving...' : 'Save Release Note'}
                                </ShadcnButton>
                            </div>
                        </div>
                    </div>
                </section>
            ) : null}

            {adminTab === 'smart-ziw' ? (
                <section className="flex flex-col gap-6">
                    <div className="flex flex-col gap-1">
                        <h3 className="text-lg font-semibold tracking-tight text-foreground">Smart-Ziw Agent</h3>
                        <p className="text-sm text-muted-foreground">Configure local mirror path and web research.</p>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                        <div className="flex items-center justify-between rounded-lg border px-4 py-3 sm:col-span-2">
                            <Label htmlFor="smart-ziw-enabled" className="text-sm font-semibold">Enable Smart-Ziw Agent</Label>
                            <Switch id="smart-ziw-enabled" checked={smartZiwConfig.smart_ziw_enabled} onCheckedChange={(checked) => setSmartZiwConfig({ ...smartZiwConfig, smart_ziw_enabled: checked })} />
                        </div>
                        <div className="flex flex-col gap-1.5 sm:col-span-2">
                            <Label htmlFor="smart-ziw-repo-path" className="text-sm font-medium">Local repo path</Label>
                            <ShadcnInput id="smart-ziw-repo-path" value={smartZiwConfig.smart_ziw_repo_path} onChange={(e) => setSmartZiwConfig({ ...smartZiwConfig, smart_ziw_repo_path: e.target.value })} />
                            {configErrors.smart_ziw_repo_path ? <p className="text-xs text-destructive">{configErrors.smart_ziw_repo_path}</p> : null}
                        </div>
                        <h4 className="text-sm font-semibold text-foreground sm:col-span-2">Web research</h4>
                        <div className="flex flex-col gap-2 rounded-lg border px-4 py-3 sm:col-span-2">
                            <div className="flex items-center justify-between">
                                <Label htmlFor="research-enabled" className="text-sm font-semibold">Enable web research</Label>
                                <Switch id="research-enabled" checked={smartZiwConfig.smart_ziw_research_enabled} onCheckedChange={(checked) => setSmartZiwConfig({ ...smartZiwConfig, smart_ziw_research_enabled: checked })} />
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Requires a Firecrawl MCP server in the <strong>Tools</strong> tab.
                            </p>
                        </div>
                        <div className="flex flex-col gap-1.5">
                            <Label htmlFor="research-timeout" className="text-sm font-medium">Research timeout (seconds)</Label>
                            <ShadcnInput id="research-timeout" type="number" min={1} value={smartZiwConfig.smart_ziw_research_timeout_seconds} onChange={(e) => { const value = Number(e.target.value); setSmartZiwConfig({ ...smartZiwConfig, smart_ziw_research_timeout_seconds: Number.isFinite(value) && value >= 1 ? value : 900 }) }} />
                            {configErrors.smart_ziw_research_timeout_seconds ? <p className="text-xs text-destructive">{configErrors.smart_ziw_research_timeout_seconds}</p> : null}
                        </div>
                        <h4 className="text-sm font-semibold text-foreground sm:col-span-2">Auto-analyze after sync</h4>
                        <div className="flex flex-col gap-2 rounded-lg border px-4 py-3 sm:col-span-2">
                            <div className="flex items-center justify-between">
                                <Label htmlFor="auto-analyze-enabled" className="text-sm font-semibold">Run agent automatically after each sync</Label>
                                <Switch id="auto-analyze-enabled" checked={smartZiwConfig.auto_analyze_enabled} onCheckedChange={(checked) => setSmartZiwConfig({ ...smartZiwConfig, auto_analyze_enabled: checked })} />
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Runs Smart-Ziw once per tender that passed AI verification, right after a successful sync, soonest deadline first. Tenders already analyzed or errored are never re-run.
                            </p>
                        </div>
                        <div className="flex flex-col gap-1.5">
                            <Label className="text-sm font-medium">Sources</Label>
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <ShadcnButton type="button" variant="outline" className="w-full justify-between font-normal">
                                        <span className="truncate">{smartZiwConfig.auto_analyze_sources.length ? smartZiwConfig.auto_analyze_sources.join(', ') : 'All sources'}</span>
                                        <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
                                    </ShadcnButton>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="start" className="max-h-64 w-56 overflow-y-auto">
                                    {autoAnalyzeSourceOptions.length === 0 ? <DropdownMenuItem disabled>No sources loaded yet</DropdownMenuItem> : autoAnalyzeSourceOptions.map((s) => (
                                        <DropdownMenuCheckboxItem key={s} checked={smartZiwConfig.auto_analyze_sources.includes(s)} onSelect={(e) => e.preventDefault()} onCheckedChange={(checked) => setSmartZiwConfig({ ...smartZiwConfig, auto_analyze_sources: checked ? [...smartZiwConfig.auto_analyze_sources, s] : smartZiwConfig.auto_analyze_sources.filter((x) => x !== s) })}>
                                            {s}
                                        </DropdownMenuCheckboxItem>
                                    ))}
                                </DropdownMenuContent>
                            </DropdownMenu>
                            <p className="text-xs text-muted-foreground">Leave empty to include every source.</p>
                        </div>
                        <div className="flex flex-col gap-1.5">
                            <Label className="text-sm font-medium">Countries</Label>
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <ShadcnButton type="button" variant="outline" className="w-full justify-between font-normal">
                                        <span className="truncate">{smartZiwConfig.auto_analyze_countries.length ? smartZiwConfig.auto_analyze_countries.join(', ') : 'All countries'}</span>
                                        <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
                                    </ShadcnButton>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="start" className="max-h-64 w-56 overflow-y-auto">
                                    {autoAnalyzeCountryOptions.length === 0 ? <DropdownMenuItem disabled>No countries loaded yet</DropdownMenuItem> : autoAnalyzeCountryOptions.map((c) => (
                                        <DropdownMenuCheckboxItem key={c} checked={smartZiwConfig.auto_analyze_countries.includes(c)} onSelect={(e) => e.preventDefault()} onCheckedChange={(checked) => setSmartZiwConfig({ ...smartZiwConfig, auto_analyze_countries: checked ? [...smartZiwConfig.auto_analyze_countries, c] : smartZiwConfig.auto_analyze_countries.filter((x) => x !== c) })}>
                                            {c}
                                        </DropdownMenuCheckboxItem>
                                    ))}
                                </DropdownMenuContent>
                            </DropdownMenu>
                            <p className="text-xs text-muted-foreground">Leave empty to include every country.</p>
                        </div>
                        <div className="flex flex-col gap-1.5">
                            <Label htmlFor="auto-analyze-max" className="text-sm font-medium">Max tenders per sync</Label>
                            <ShadcnInput id="auto-analyze-max" type="number" min={0} value={smartZiwConfig.auto_analyze_max_per_run} onChange={(e) => { const value = Number(e.target.value); setSmartZiwConfig({ ...smartZiwConfig, auto_analyze_max_per_run: Number.isFinite(value) && value >= 0 ? value : 10 }) }} />
                            <p className="text-xs text-muted-foreground">0 disables auto-analysis.</p>
                        </div>
                    </div>
                    <div className="flex justify-end">
                        <ShadcnButton type="button" onClick={saveSmartZiwConfig} disabled={savingSmartZiwConfig}>
                            {savingSmartZiwConfig ? 'Saving...' : 'Save config'}
                        </ShadcnButton>
                    </div>
                </section>
            ) : null}

            {adminTab === 'mcp-servers' ? (
                <section className="flex flex-col gap-6">
                    <div className="flex flex-col gap-1">
                        <h3 className="text-lg font-semibold tracking-tight text-foreground">Tools</h3>
                        <p className="text-sm text-muted-foreground">API keys for the built-in tool backends, plus external MCP servers over SSE / HTTP. Each MCP server's tools become Smart-Ziw skills when enabled.</p>
                    </div>
                    <div className="flex flex-col gap-6">
                        <div className="rounded-xl border bg-card/50 p-6">
                            <div className="mb-3 flex items-center justify-between gap-3">
                                <h4 className="text-sm font-semibold text-foreground">{editingMcpId ? 'Edit MCP server' : 'Add MCP server'}</h4>
                                {editingMcpId ? (
                                    <ShadcnButton type="button" variant="ghost" size="sm" onClick={resetMcpForm}>Cancel edit</ShadcnButton>
                                ) : null}
                            </div>
                            <div className="grid gap-4 sm:grid-cols-2">
                                <div className="flex flex-col gap-1.5">
                                    <Label htmlFor="mcp-name" className="text-sm font-medium">Name</Label>
                                    <ShadcnInput id="mcp-name" value={mcpForm.name} onChange={(e) => setMcpForm({ ...mcpForm, name: e.target.value })} placeholder="My MCP server" />
                                    {mcpErrors.name ? <p className="text-xs text-destructive">{mcpErrors.name}</p> : null}
                                </div>
                                <div className="flex flex-col gap-1.5 sm:col-span-2">
                                    <Label htmlFor="mcp-url" className="text-sm font-medium">SSE / HTTP URL</Label>
                                    <ShadcnInput id="mcp-url" type="url" value={mcpForm.url} onChange={(e) => setMcpForm({ ...mcpForm, url: e.target.value })} placeholder="https://mcp.example.com/sse" />
                                    {mcpErrors.url ? <p className="text-xs text-destructive">{mcpErrors.url}</p> : null}
                                </div>
                                <div className="flex flex-col gap-1.5">
                                    <Label htmlFor="mcp-timeout" className="text-sm font-medium">Timeout (seconds)</Label>
                                    <ShadcnInput id="mcp-timeout" type="number" min={1} value={mcpForm.timeout} onChange={(e) => setMcpForm({ ...mcpForm, timeout: e.target.value })} />
                                </div>
                                <div className="flex items-center justify-between rounded-lg border px-4 py-3">
                                    <Label htmlFor="mcp-enabled" className="text-sm font-semibold">Enabled</Label>
                                    <Switch id="mcp-enabled" checked={mcpForm.enabled} onCheckedChange={(checked) => setMcpForm({ ...mcpForm, enabled: checked })} />
                                </div>
                                <div className="flex flex-col gap-1.5 sm:col-span-2">
                                    <Label htmlFor="mcp-headers" className="text-sm font-medium">Authentication headers (KEY=value, one per line)</Label>
                                    <Textarea id="mcp-headers" rows={3} value={mcpForm.headersText} onChange={(e) => setMcpForm({ ...mcpForm, headersText: e.target.value })} placeholder={'Authorization=Bearer sk-...'} />
                                    <p className="text-xs text-muted-foreground">Sent with every connection. Stored values are hidden after saving.</p>
                                </div>
                                <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
                                    <ShadcnButton type="button" variant="outline" onClick={testMcpServer} disabled={mcpTesting || mcpSaving}>
                                        {mcpTesting ? 'Testing...' : 'Test connection'}
                                    </ShadcnButton>
                                    <ShadcnButton type="button" onClick={saveMcpServer} disabled={mcpSaving || mcpTesting}>
                                        {mcpSaving ? 'Saving...' : (editingMcpId ? 'Save changes' : 'Add server')}
                                    </ShadcnButton>
                                </div>
                                {mcpTestResult ? (
                                    <div className={`rounded-lg border p-4 sm:col-span-2 ${mcpTestResult.status === 'ok' ? 'border-success/25 bg-success/10' : 'border-destructive/25 bg-destructive/10'}`}>
                                        <div className="flex items-center gap-2">
                                            <Badge variant="outline" className={mcpTestResult.status === 'ok' ? 'gap-1 border-success/25 bg-success/10 text-success' : 'gap-1 border-destructive/25 bg-destructive/10 text-destructive'}>
                                                <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
                                                {mcpTestResult.status === 'ok' ? 'Connected' : 'Failed'}
                                            </Badge>
                                            <span className="text-sm text-muted-foreground">{mcpTestResult.detail}</span>
                                        </div>
                                        {mcpTestResult.status === 'ok' && mcpTestResult.tools.length > 0 ? (
                                            <div className="mt-3 flex flex-wrap gap-1.5">
                                                {mcpTestResult.tools.map((tool) => (
                                                    <Badge key={tool.name} variant="secondary">{tool.name}</Badge>
                                                ))}
                                            </div>
                                        ) : null}
                                    </div>
                                ) : null}
                            </div>
                        </div>

                        <div>
                            <h4 className="mb-3 text-sm font-semibold text-foreground">Pre-configured servers</h4>
                            {mcpServersLoading ? (
                                <p className="text-sm text-muted-foreground">Loading MCP servers...</p>
                            ) : (
                                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                                    {mcpServers.filter((server) => server.builtin).map((server) => (
                                        <Card key={server.id} className="flex flex-col">
                                            <CardHeader className="pb-3">
                                                <div className="flex items-start justify-between gap-3">
                                                    <CardTitle className="text-base">{server.name}</CardTitle>
                                                    <div className="flex items-center gap-1.5">
                                                        <Badge variant="outline">{server.transport === 'http' ? 'HTTP' : 'SSE'}</Badge>
                                                        <Badge
                                                            variant="outline"
                                                            className={server.api_key_configured ? 'gap-1 border-success/25 bg-success/10 text-success' : 'gap-1 border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400'}
                                                        >
                                                            <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
                                                            {server.api_key_configured ? 'Key saved' : 'Key required'}
                                                        </Badge>
                                                    </div>
                                                </div>
                                                <p className="text-sm text-muted-foreground break-all">{server.url}</p>
                                            </CardHeader>
                                            <CardContent className="flex flex-1 flex-col gap-3 pt-0">
                                                <div className="flex flex-wrap gap-1.5">
                                                    {(server.tools || []).map((tool) => (
                                                        <Badge key={tool.name} variant="secondary">{tool.name}</Badge>
                                                    ))}
                                                    {(server.tools || []).length === 0 ? (
                                                        <span className="text-sm text-muted-foreground">
                                                            {server.id === 'brave-search'
                                                                ? 'Native API integration — the built-in web search tool calls Brave\'s LLM Context API directly with this key. No MCP tools to list.'
                                                                : 'Tools are discovered when the API key is saved.'}
                                                        </span>
                                                    ) : null}
                                                </div>
                                                <div className="mt-auto flex flex-col gap-2">
                                                    <Label htmlFor={`mcp-key-${server.id}`} className="text-sm font-medium">
                                                        API key{server.api_key_configured ? ' (enter to replace)' : ''}
                                                    </Label>
                                                    <div className="flex gap-2">
                                                        <ShadcnInput
                                                            id={`mcp-key-${server.id}`}
                                                            type="password"
                                                            value={builtinMcpKeys[server.id] || ''}
                                                            onChange={(e) => setBuiltinMcpKeys((prev) => ({ ...prev, [server.id]: e.target.value }))}
                                                            placeholder={server.api_key_configured ? 'Saved — type to replace' : `Your ${server.name} API key`}
                                                            className="flex-1"
                                                        />
                                                        <ShadcnButton onClick={() => saveBuiltinMcpKey(server)} disabled={builtinMcpSavingId === server.id}>
                                                            {builtinMcpSavingId === server.id ? 'Saving...' : 'Save key'}
                                                        </ShadcnButton>
                                                    </div>
                                                    <p className="text-xs text-muted-foreground">
                                                        Sent as the <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">{server.api_key_header}</code> header. Stored hidden.
                                                    </p>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <Switch
                                                        id={`mcp-enabled-${server.id}`}
                                                        checked={server.enabled !== false}
                                                        onCheckedChange={() => toggleMcpServer(server)}
                                                    />
                                                    <Label htmlFor={`mcp-enabled-${server.id}`} className="text-sm">{server.enabled !== false ? 'Enabled' : 'Disabled'}</Label>
                                                </div>
                                            </CardContent>
                                        </Card>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div>
                            <h4 className="mb-3 text-sm font-semibold text-foreground">Custom servers</h4>
                            {mcpServersLoading ? (
                                <p className="text-sm text-muted-foreground">Loading MCP servers...</p>
                            ) : mcpServers.filter((server) => !server.builtin).length === 0 ? (
                                <p className="text-sm text-muted-foreground">No custom MCP servers configured yet.</p>
                            ) : (
                                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                                    {mcpServers.filter((server) => !server.builtin).map((server) => (
                                        <Card key={server.id} className="flex flex-col">
                                            <CardHeader className="pb-3">
                                                <div className="flex items-start justify-between gap-3">
                                                    <CardTitle className="text-base">{server.name}</CardTitle>
                                                    <Badge variant="outline">{server.transport === 'http' ? 'HTTP' : 'SSE'}</Badge>
                                                </div>
                                                <p className="text-sm text-muted-foreground break-all">{server.url}</p>
                                            </CardHeader>
                                            <CardContent className="flex flex-1 flex-col gap-3 pt-0">
                                                <div className="flex flex-wrap gap-1.5">
                                                    {(server.tools || []).map((tool) => (
                                                        <Badge key={tool.name} variant="secondary">{tool.name}</Badge>
                                                    ))}
                                                    {(server.tools || []).length === 0 ? (
                                                        <span className="text-sm text-muted-foreground">No tools cached yet</span>
                                                    ) : null}
                                                </div>
                                                <div className="mt-auto flex items-center justify-between gap-3">
                                                    <div className="flex items-center gap-2">
                                                        <Switch
                                                            id={`mcp-enabled-${server.id}`}
                                                            checked={server.enabled !== false}
                                                            onCheckedChange={() => toggleMcpServer(server)}
                                                        />
                                                        <Label htmlFor={`mcp-enabled-${server.id}`} className="text-sm">{server.enabled !== false ? 'Enabled' : 'Disabled'}</Label>
                                                    </div>
                                                    <div className="flex items-center gap-1">
                                                        <ShadcnButton
                                                            type="button"
                                                            variant="ghost"
                                                            size="icon-sm"
                                                            aria-label={`Edit ${server.name}`}
                                                            onClick={() => startEditMcpServer(server)}
                                                        >
                                                            <PenLine className="h-4 w-4" />
                                                        </ShadcnButton>
                                                        <ShadcnButton
                                                            type="button"
                                                            variant="ghost"
                                                            size="icon-sm"
                                                            aria-label={`Delete ${server.name}`}
                                                            onClick={() => deleteMcpServer(server.id)}
                                                        >
                                                            <Trash2 className="h-4 w-4 text-destructive" />
                                                        </ShadcnButton>
                                                    </div>
                                                </div>
                                            </CardContent>
                                        </Card>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </section>
            ) : null}

            {adminTab === 'llm' ? (
                <section className="flex flex-col gap-6">
                    <div className="flex flex-col gap-1">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <h3 className="text-lg font-semibold tracking-tight text-foreground">LLM Provider</h3>
                            <Badge variant="secondary">
                                {llmEnvProvider
                                    ? `Environment · ${llmEnvStatus.model || 'default'}`
                                    : `${llmProviders.find((p) => p.id === smartZiwConfig.smart_ziw_llm_provider)?.name || 'Provider'} · ${smartZiwConfig.lightllm_model || 'not set'}`}
                            </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">Configure the LLM backend used by the Smart-Ziw agent.</p>
                    </div>
                    {llmStatus ? (
                        <div className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 ${llmStatus.configured ? 'border-success/25 bg-success/5' : 'border-amber-500/30 bg-amber-500/5'}`}>
                            <div className="flex items-center gap-3">
                                <Badge
                                    variant="outline"
                                    className={llmStatus.configured ? 'gap-1 border-success/25 bg-success/10 text-success' : 'gap-1 border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400'}
                                >
                                    <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
                                    {llmStatus.configured ? 'Configured' : 'Not configured'}
                                </Badge>
                                <div className="flex flex-col">
                                    <span className="text-sm font-medium text-foreground">{llmStatus.provider_name}</span>
                                    <span className="text-xs text-muted-foreground">
                                        Model <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground">{llmStatus.model || 'not set'}</code>
                                        {' '}· resolved from {llmStatus.source === 'environment' ? 'environment (.env)' : 'this configuration'}
                                    </span>
                                </div>
                            </div>
                            {!llmStatus.configured && llmStatus.missing_fields?.length ? (
                                <span className="text-xs text-amber-600 dark:text-amber-400">
                                    Missing: {llmStatus.missing_fields.map((field) => (field === 'api_key' ? 'API key' : 'Base URL')).join(', ')}
                                </span>
                            ) : null}
                        </div>
                    ) : null}
                    <div className="grid gap-4 sm:grid-cols-2">
                        <div className="flex flex-col gap-1.5 sm:col-span-2">
                            <Label htmlFor="llm-provider" className="text-sm font-medium">Provider</Label>
                            <Select
                                value={smartZiwConfig.smart_ziw_llm_provider}
                                onValueChange={(value) => {
                                    llmDiscoverySeq.current += 1;
                                    setLlmModelsLoading(false);
                                    setLlmModels({ status: 'idle', models: [], detail: null });
                                    const preset = llmProviders.find((p) => p.id === value);
                                    setSmartZiwConfig((prev) => ({
                                        ...prev,
                                        smart_ziw_llm_provider: value,
                                        lightllm_base_url: value === 'local' ? (prev.lightllm_base_url || preset?.base_url || '') : (value === 'custom' ? prev.lightllm_base_url : ''),
                                        lightllm_model: preset?.default_model || prev.lightllm_model,
                                        lightllm_provider: preset?.format === 'anthropic' ? 'anthropic_compatible' : 'openai_compatible',
                                    }));
                                }}
                                disabled={llmProvidersLoading}
                            >
                                <SelectTrigger id="llm-provider" className="w-full" aria-label="LLM provider">
                                    <SelectValue placeholder="Select a provider">
                                        {(() => {
                                            const p = llmProviders.find((x) => x.id === smartZiwConfig.smart_ziw_llm_provider);
                                            return p ? (
                                                <span className="flex items-center gap-2">
                                                    <ProviderLogo id={p.id} name={p.name} />
                                                    {p.name}
                                                </span>
                                            ) : null;
                                        })()}
                                    </SelectValue>
                                </SelectTrigger>
                                <SelectContent>
                                    {llmProviders.map((p) => (
                                        <SelectItem key={p.id} value={p.id}>
                                            <span className="flex items-center gap-2">
                                                <ProviderLogo id={p.id} name={p.name} />
                                                {p.name}
                                            </span>
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            {llmProvidersLoading ? <p className="text-sm text-muted-foreground">Loading providers…</p> : null}
                        </div>
                        {llmEnvProvider ? (
                            <div className="flex flex-col gap-1.5 sm:col-span-2">
                                <Label className="text-sm font-medium">Environment configuration</Label>
                                <p className="text-sm text-muted-foreground">
                                    {llmEnvStatus.model
                                        ? <>Using model <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground">{llmEnvStatus.model}</code> from environment configuration ({llmEnvStatus.api_key_set ? 'API key set' : 'no API key set'}). To change these values, edit the .env file on the server and restart the backend.</>
                                        : 'Loading environment status…'}
                                </p>
                            </div>
                        ) : (
                            <>
                                {(smartZiwConfig.smart_ziw_llm_provider === 'local' || smartZiwConfig.smart_ziw_llm_provider === 'custom') && (
                                    <div className="flex flex-col gap-1.5 sm:col-span-2">
                                        <Label htmlFor="llm-base-url" className="text-sm font-medium">Base URL</Label>
                                        <ShadcnInput id="llm-base-url" value={smartZiwConfig.lightllm_base_url} onChange={(e) => { llmDiscoverySeq.current += 1; setLlmModelsLoading(false); setLlmModels({ status: 'idle', models: [], detail: null }); setSmartZiwConfig({ ...smartZiwConfig, lightllm_base_url: e.target.value }); }} placeholder={smartZiwConfig.smart_ziw_llm_provider === 'local' ? 'http://localhost:8000/v1' : 'https://your-server/v1'} />
                                        {configErrors.lightllm_base_url ? <p className="text-xs text-destructive">{configErrors.lightllm_base_url}</p> : null}
                                    </div>
                                )}
                                <div className="flex flex-col gap-1.5 sm:col-span-2">
                                    <Label htmlFor="llm-api-key" className="text-sm font-medium">API key</Label>
                                    <ShadcnInput id="llm-api-key" type="password" value={smartZiwConfig.lightllm_api_key} onChange={(e) => setSmartZiwConfig({ ...smartZiwConfig, lightllm_api_key: e.target.value })} placeholder="Leave blank to keep the stored key" />
                                </div>
                                <div className="flex flex-col gap-1.5 sm:col-span-2">
                                    <Label htmlFor="llm-subscription-key" className="text-sm font-medium">Subscription / secondary key</Label>
                                    <ShadcnInput id="llm-subscription-key" type="password" value={smartZiwConfig.lightllm_subscription_key} onChange={(e) => setSmartZiwConfig({ ...smartZiwConfig, lightllm_subscription_key: e.target.value })} placeholder="Only if your provider requires a separate subscription or project key" />
                                    <p className="text-sm text-muted-foreground">Provider-specific. Sent as the <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">X-Subscription-Key</code> header when set.</p>
                                </div>
                                {smartZiwConfig.smart_ziw_llm_provider === 'custom' && (
                                    <div className="flex flex-col gap-1.5 sm:col-span-2">
                                        <Label className="text-sm font-medium">Server type</Label>
                                        <Select value={smartZiwConfig.lightllm_provider} onValueChange={(value) => { llmDiscoverySeq.current += 1; setLlmModelsLoading(false); setSmartZiwConfig({ ...smartZiwConfig, lightllm_provider: value }); }}>
                                            <SelectTrigger className="w-full" aria-label="Server type"><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="openai_compatible">OpenAI-compatible</SelectItem>
                                                <SelectItem value="anthropic_compatible">Anthropic-compatible</SelectItem>
                                                <SelectItem value="custom">Custom (enter model manually)</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                )}
                                <div className="flex flex-col gap-1.5 sm:col-span-2">
                                    <Label className="text-sm font-medium">Model</Label>
                                    {(() => {
                                        const preset = llmProviders.find((p) => p.id === smartZiwConfig.smart_ziw_llm_provider);
                                        const hardcoded = Array.isArray(preset?.hardcoded_models) ? preset.hardcoded_models : [];
                                        const discovered = llmModels.status === 'ok' ? llmModels.models : [];
                                        const models = discovered.length ? discovered : hardcoded;
                                        const isCustomManual = smartZiwConfig.smart_ziw_llm_provider === 'custom' && smartZiwConfig.lightllm_provider === 'custom';
                                        if (models.length && !isCustomManual) {
                                            return (
                                                <Select value={smartZiwConfig.lightllm_model} onValueChange={(value) => setSmartZiwConfig({ ...smartZiwConfig, lightllm_model: value })}>
                                                    <SelectTrigger className="w-full" aria-label="Model"><SelectValue placeholder="Select a model" /></SelectTrigger>
                                                    <SelectContent>
                                                        {!models.some((m) => m.id === smartZiwConfig.lightllm_model) && smartZiwConfig.lightllm_model ? (
                                                            <SelectItem value={smartZiwConfig.lightllm_model}>{smartZiwConfig.lightllm_model} (current)</SelectItem>
                                                        ) : null}
                                                        {models.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                                                    </SelectContent>
                                                </Select>
                                            );
                                        }
                                        return <ShadcnInput value={smartZiwConfig.lightllm_model} onChange={(e) => setSmartZiwConfig({ ...smartZiwConfig, lightllm_model: e.target.value })} placeholder="Model name" />;
                                    })()}
                                    <p className="text-sm text-muted-foreground">
                                        {llmModels.status === 'loading' ? 'Loading available models…'
                                            : llmModels.status === 'ok' ? 'Models loaded.'
                                            : llmModels.status === 'no_models' ? 'No models available from this provider. You can type the model name manually.'
                                            : llmModels.status === 'auth_required' ? 'This provider requires an API key to retrieve available models. Enter the API key and refresh.'
                                            : llmModels.status === 'unsupported' ? 'This provider does not support automatic model discovery. Enter the model name manually.'
                                            : llmModels.status === 'error' ? (llmModels.detail || 'Unable to connect to the provider. Check the base URL.')
                                            : ''}
                                    </p>
                                    {(() => {
                                        const preset = llmProviders.find((p) => p.id === smartZiwConfig.smart_ziw_llm_provider);
                                        const isCustomManual = smartZiwConfig.smart_ziw_llm_provider === 'custom' && smartZiwConfig.lightllm_provider === 'custom';
                                        const effectiveUrl = smartZiwConfig.lightllm_base_url.trim() || preset?.base_url || '';
                                        const canDiscover = preset && (preset.format === 'openai' || preset.format === 'anthropic') && !isCustomManual && effectiveUrl;
                                        return (
                                            <ShadcnButton type="button" variant="outline" size="sm" className="w-fit" onClick={() => discoverLlmModels(smartZiwConfig.smart_ziw_llm_provider, effectiveUrl, smartZiwConfig.lightllm_api_key, smartZiwConfig.lightllm_subscription_key)} disabled={llmModelsLoading || !canDiscover}>
                                                Refresh models
                                            </ShadcnButton>
                                        );
                                    })()}
                                </div>
                            </>
                        )}
                        <Collapsible className="border-t pt-4 sm:col-span-2">
                            <CollapsibleTrigger asChild>
                                <ShadcnButton type="button" variant="ghost" size="sm" className="h-auto gap-1.5 px-2 py-1 text-sm font-semibold text-muted-foreground hover:text-foreground">
                                    <ChevronDown className="h-4 w-4" />
                                    Advanced settings
                                </ShadcnButton>
                            </CollapsibleTrigger>
                            <CollapsibleContent>
                                <div className="grid gap-4 pt-4 sm:grid-cols-2">
                                    <div className="flex flex-col gap-1.5">
                                        <Label htmlFor="llm-temperature" className="text-sm font-medium">Temperature</Label>
                                        <ShadcnInput id="llm-temperature" type="number" min="0" max="2" step="0.1" value={smartZiwConfig.llm_temperature ?? 0.1} onChange={(e) => { const value = parseFloat(e.target.value); setSmartZiwConfig({ ...smartZiwConfig, llm_temperature: Number.isFinite(value) ? value : 0.1 }); }} />
                                        <p className="text-sm text-muted-foreground">Controls response randomness. Default 0.1. Some models (e.g. reasoning models) only accept 1.</p>
                                        {configErrors.llm_temperature ? <p className="text-xs text-destructive">{configErrors.llm_temperature}</p> : null}
                                    </div>
                                    <div className="flex flex-col gap-1.5">
                                        <Label htmlFor="llm-max-tokens" className="text-sm font-medium">Max tokens</Label>
                                        <ShadcnInput id="llm-max-tokens" type="number" min="1" step="1" value={smartZiwConfig.llm_max_tokens ?? 4000} onChange={(e) => { const value = parseInt(e.target.value, 10); setSmartZiwConfig({ ...smartZiwConfig, llm_max_tokens: Number.isFinite(value) ? value : 4000 }); }} />
                                        <p className="text-sm text-muted-foreground">Maximum tokens per response. Default 4000.</p>
                                        {configErrors.llm_max_tokens ? <p className="text-xs text-destructive">{configErrors.llm_max_tokens}</p> : null}
                                    </div>
                                </div>
                            </CollapsibleContent>
                        </Collapsible>
                    </div>
                    <div className="flex justify-end">
                        <ShadcnButton type="button" onClick={testAndSaveLlmConfig} disabled={savingSmartZiwConfig}>
                            {testingLlm ? 'Testing…' : savingSmartZiwConfig ? 'Saving...' : 'Save config'}
                        </ShadcnButton>
                    </div>
                </section>
            ) : null}

            {adminTab === 'system-prompts' ? (
                <section className="flex flex-col gap-6">
                    <div className="flex flex-col gap-1">
                        <h3 className="text-lg font-semibold tracking-tight text-foreground">Tender Classifier</h3>
                        <p className="text-sm text-muted-foreground">
                            The classifier decides whether a scraped tender is cybersecurity-relevant (the <strong>AI verified</strong> flag).
                            Only verified tenders are eligible for auto-analysis, so these prompts gate what the agent works on.
                            They do not affect the agent's own analysis style.
                        </p>
                    </div>
                    <div className="grid gap-6">
                        <div className="flex flex-col gap-1.5">
                            <Label htmlFor="ai-verification-system-prompt" className="text-sm font-medium">Classifier prompt</Label>
                            <Textarea
                                id="ai-verification-system-prompt"
                                rows={8}
                                className="w-full"
                                value={smartZiwConfig.ai_verification_system_prompt}
                                onChange={(e) => setSmartZiwConfig({ ...smartZiwConfig, ai_verification_system_prompt: e.target.value })}
                                placeholder="Define what counts as cybersecurity-relevant and the exact output format..."
                            />
                        </div>
                        <div className="flex flex-col gap-1.5">
                            <Label htmlFor="ai-verification-expertise" className="text-sm font-medium">Company expertise / focus</Label>
                            <Textarea
                                id="ai-verification-expertise"
                                rows={8}
                                className="w-full"
                                value={smartZiwConfig.ai_verification_expertise}
                                onChange={(e) => setSmartZiwConfig({ ...smartZiwConfig, ai_verification_expertise: e.target.value })}
                                placeholder="Describe the services, sectors, and geographies the company is interested in..."
                            />
                        </div>
                        <div className="flex flex-col gap-1.5">
                            <Label htmlFor="ai-verification-unwanted" className="text-sm font-medium">Unwanted services / products</Label>
                            <Textarea
                                id="ai-verification-unwanted"
                                rows={8}
                                className="w-full"
                                value={smartZiwConfig.ai_verification_unwanted}
                                onChange={(e) => setSmartZiwConfig({ ...smartZiwConfig, ai_verification_unwanted: e.target.value })}
                                placeholder="List services, products, or project types the AI should reject..."
                            />
                        </div>
                    </div>
                    <div className="flex justify-end">
                        <ShadcnButton type="button" onClick={saveSystemPrompts} disabled={savingSystemPrompts}>
                            {savingSystemPrompts ? 'Saving...' : 'Save classifier'}
                        </ShadcnButton>
                    </div>
                </section>
            ) : null}
                </div>
            </div>

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
            <Dialog open={deleteModal.open} onOpenChange={(open) => { if (!open) setDeleteModal({ open: false, user: null }); }}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Delete user</DialogTitle>
                        <DialogDescription>
                            This will permanently remove {deleteModal.user?.name || deleteModal.user?.email || 'this user'}.
                            This action cannot be undone.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="gap-2 sm:justify-end">
                        <ShadcnButton variant="outline" onClick={() => setDeleteModal({ open: false, user: null })} disabled={!!deletingUserId}>
                            Cancel
                        </ShadcnButton>
                        <ShadcnButton variant="destructive" onClick={deleteUser} disabled={!!deletingUserId}>
                            {deletingUserId ? 'Deleting...' : 'Delete user'}
                        </ShadcnButton>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            <Dialog open={toggleModal.open} onOpenChange={(open) => { if (!open) setToggleModal({ open: false, user: null }); }}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>{toggleModal.user?.isActive ? 'Deactivate user?' : 'Activate user?'}</DialogTitle>
                    </DialogHeader>
                    <p className="text-sm text-muted-foreground">
                        This will {toggleModal.user?.isActive ? 'deactivate' : 'activate'} {toggleModal.user?.name || toggleModal.user?.email || 'this user'}.
                    </p>
                    <DialogFooter className="mt-2 gap-2 sm:justify-end">
                        <ShadcnButton variant="outline" onClick={() => setToggleModal({ open: false, user: null })}>Cancel</ShadcnButton>
                        <ShadcnButton onClick={confirmToggleUser} disabled={!!togglingUserId}>
                            {togglingUserId === toggleModal.user?.id ? 'Updating…' : 'Confirm'}
                        </ShadcnButton>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

export default function App() {
    const { theme, setTheme, resolvedTheme } = useTheme();
    const { title, subtitle, action } = usePageHeader();
    const [loading, setLoading] = useState(true);
    const [projects, setProjects] = useState([]);
    const [newProjectIds, setNewProjectIds] = useState(new Set());
    const [projectsLoading, setProjectsLoading] = useState(false);
    const [projectsError, setProjectsError] = useState(null);
    const [regions, setRegions] = useState({});
    const [continents, setContinents] = useState([]);
    const [demoOpen, setDemoOpen] = useState(false);

    const [authUser, setAuthUser] = useState(null);
    const [availableUsers, setAvailableUsers] = useState([]);
    const [authError, setAuthError] = useState('');
    const [mustChangeError, setMustChangeError] = useState('');
    const [bootstrapStatus, setBootstrapStatus] = useState(null);
    const [releaseNotesOpen, setReleaseNotesOpen] = useState(false);
    const [releaseNotes, setReleaseNotes] = useState(DEFAULT_RELEASE_NOTES);

    const [route, setRoute] = useState(normalizeRoute(window.location.hash.replace('#', '')));
    // State (not a window read) so hash changes always re-render: normalizeRoute maps
    // 'tenders/...' back to 'dashboard', so setRoute alone can bail out and leave the
    // dashboard on screen after opening a tender from an idle dashboard.
    const [tenderDetailId, setTenderDetailId] = useState(getTenderIdFromHash(window.location.hash));
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const [mobileNavOpen, setMobileNavOpen] = useState(false);
    const [commandOpen, setCommandOpen] = useState(false);
    const [syncOpen, setSyncOpen] = useState(false);
    const [notificationsOpen, setNotificationsOpen] = useState(false);
    const [notifications, setNotifications] = useState([]);
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

    // Admin-only routes fall back to dashboard for non-admins
    useEffect(() => {
        if (authUser && authUser.role !== 'admin' && (route === 'settings' || route === 'schedule')) {
            navigate('dashboard');
        }
    }, [authUser, route]);

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
            setTenderDetailId(getTenderIdFromHash(window.location.hash));
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
        setProjectsLoading(true);
        setProjectsError(null);
        try {
            const res = await apiFetch(`${API}/projects`);
            if (!res.ok) throw new Error(`Failed to load tenders (${res.status})`);
            const data = await res.json();
            setProjects(attachProjectRowIds(Array.isArray(data) ? data : []));
        } catch (err) {
            setProjectsError(err?.message || 'Unable to load tenders');
        } finally {
            setProjectsLoading(false);
        }
    }, [apiFetch]);

    useEffect(() => {
        if (!authUser || authUser.mustChangePassword) return;
        loadProjects();
        Promise.all([
            apiFetch('/api/config').then((r) => (r.ok ? r.json() : { regions: {} })),
            apiFetch('/api/geography').then((r) => (r.ok ? r.json() : { continents: [] })),
            apiFetch('/api/release-notes').then((r) => (r.ok ? r.json() : { notes: DEFAULT_RELEASE_NOTES })),
            apiFetch('/api/users').then((r) => (r.ok ? r.json() : [])),
            apiFetch('/api/notifications?limit=5000').then((r) => (r.ok ? r.json() : { notifications: [] })),
        ])
            .then(([cfg, geography, noteData, userData, notificationData]) => {
                setRegions(cfg.regions || {});
                setContinents(geography.continents || []);
                const notes = Array.isArray(noteData?.notes) && noteData.notes.length ? noteData.notes : DEFAULT_RELEASE_NOTES;
                setReleaseNotes([...notes].sort((a, b) => compareVersionStrings(b.version, a.version)));
                setAvailableUsers(Array.isArray(userData) ? userData : []);
                setNotifications(Array.isArray(notificationData?.notifications) ? notificationData.notifications : []);
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
        return [];
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











    const openProjectFromNotification = useCallback(async (notification) => {
        if (!notification) return;
        const projectDbId = notification.projectDbId;
        const project = projects.find((item) => (
            (projectDbId && item.db_id === projectDbId)
            || (notification.entityId && (item.project_id === notification.entityId || item.project_name === notification.entityId))
        ));
        const targetDbId = project?.db_id || projectDbId;
        if (!targetDbId) {
            window.alert('Project not found for this notification.');
            return;
        }
        if (!notification.read) {
            await markNotificationGroupAsRead(notification.notificationIds || [notification.id]);
        }
        setNotificationsOpen(false);
        setRoute('dashboard');
        window.location.hash = buildTenderHash(targetDbId);
    }, [projects, markNotificationGroupAsRead]);

    const navigate = (key) => {
        if (key === 'logout') {
            doLogout();
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
        else if (key === 'settings') navigate('settings');
        else if (key === 'schedule') navigate('schedule');
        else if (key === 'logout') doLogout();
    };

    if (loading) return <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background"><div className="size-8 animate-spin rounded-full border-2 border-primary border-t-transparent" /><p className="text-sm text-muted-foreground">Loading...</p></div>;
    if (!authUser) return <LoginPage onLogin={doLogin} error={authError} bootstrap={bootstrapStatus} />;
    if (authUser.mustChangePassword) return <ForcePasswordPage onSubmit={doChangePassword} error={mustChangeError} />;

    return (
        <div className="flex min-h-screen">
            <Toaster />
            <SidebarProvider open={!sidebarCollapsed} onOpenChange={(open) => setSidebarCollapsed(!open)}>
                <Sidebar
                    user={authUser}
                    route={route}
                    onNavigate={navigate}
                    onCloseMobile={() => setMobileNavOpen(false)}
                    onOpenCommand={() => setCommandOpen(true)}
                />
                <div className="flex min-w-0 flex-1 flex-col">
                <div className="min-h-0 flex-1 overflow-auto">
                    <div className="w-full px-4 py-6 md:px-6 lg:px-8 lg:py-8">
                        <div className="app-top-header sticky top-0 z-20 -mx-4 flex items-center justify-between gap-4 border-b border-border bg-background/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6 lg:-mx-8 lg:px-8 mb-6">
                            <PageHeader title={title} subtitle={subtitle} inline className="min-w-0" />
                            <div className="flex shrink-0 items-center gap-1">
                                {action ? <div className="flex items-center gap-2 pr-2">{action}</div> : null}
                                <TooltipProvider>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <ShadcnButton variant="ghost" size="icon" className="relative transition-colors duration-200" aria-label="Notifications" onClick={() => setNotificationsOpen(true)}>
                                                <Bell className="h-4 w-4" />
                                                {unreadNotificationCount ? <Badge variant="destructive" className="absolute -right-1 -top-1 h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] leading-none">{unreadNotificationCount}</Badge> : null}
                                            </ShadcnButton>
                                        </TooltipTrigger>
                                        <TooltipContent>Notifications</TooltipContent>
                                    </Tooltip>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <ShadcnButton variant="ghost" size="icon" className="transition-colors duration-200" aria-label="Sync now" onClick={() => setSyncOpen(true)}>
                                                <RefreshCw className="h-4 w-4" />
                                            </ShadcnButton>
                                        </TooltipTrigger>
                                        <TooltipContent>Sync now</TooltipContent>
                                    </Tooltip>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <ShadcnButton variant="ghost" size="icon" className="transition-colors duration-200" aria-label="Show me around" onClick={() => setDemoOpen(true)}>
                                                <CircleHelp className="h-4 w-4" />
                                            </ShadcnButton>
                                        </TooltipTrigger>
                                        <TooltipContent>Show me around</TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>
                                <div className="mx-2 h-5 w-px bg-border" />
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <ShadcnButton variant="ghost" size="icon" className="rounded-full transition-colors duration-200" aria-label="Account menu">
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
                                        <DropdownMenuSub>
                                            <DropdownMenuSubTrigger>
                                                <SunMoon className="mr-2 h-4 w-4" />Appearance
                                            </DropdownMenuSubTrigger>
                                            <DropdownMenuSubContent>
                                                <DropdownMenuItem onSelect={() => setTheme('light')} className={theme === 'light' ? 'bg-accent' : ''}>Light</DropdownMenuItem>
                                                <DropdownMenuItem onSelect={() => setTheme('dark')} className={theme === 'dark' ? 'bg-accent' : ''}>Dark</DropdownMenuItem>
                                                <DropdownMenuItem onSelect={() => setTheme('system')} className={theme === 'system' ? 'bg-accent' : ''}>System</DropdownMenuItem>
                                            </DropdownMenuSubContent>
                                        </DropdownMenuSub>
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
                        <ErrorBoundary>
{tenderDetailId && isTenderFullPageHash(window.location.hash) ? (
                            <TenderDetailPage
                                dbId={tenderDetailId}
                                apiFetch={apiFetch}
                                authUser={authUser}
                                availableUsers={availableUsers}
                                navigate={navigate}
                            />
                        ) : null}
{route === 'dashboard' && !isTenderFullPageHash(window.location.hash) ? (
                            <TendersPage
                                apiFetch={apiFetch}
                                authUser={authUser}
                                availableUsers={availableUsers}
                                regions={regions}
                                continents={continents}
                                sources={sources}
                                dashboardStats={dashboardStats}
                                projects={projects}
                                setProjects={setProjects}
                                projectsLoading={projectsLoading}
                                projectsError={projectsError}
                                loadProjects={loadProjects}
                                newProjectIds={newProjectIds}
                                onStartDemo={() => setDemoOpen(true)}
                            />
                        ) : null}
                        </ErrorBoundary>

                        {ADMIN_ROUTES.includes(route) && authUser.role === 'admin' ? (
                            <AdminPage
                                key={route}
                                apiFetch={apiFetch}
                                authUser={authUser}
                                projects={projects}
                                initialTab={route === 'llm-config' ? 'llm' : route === 'smart-ziw' ? 'smart-ziw' : route === 'mcp-servers' ? 'mcp-servers' : route === 'system-prompts' ? 'system-prompts' : 'users'}
                            />
                        ) : null}
                        {route === 'analytics' ? <AnalyticsPage /> : null}
                        {route === 'profile' ? <ProfilePage user={authUser} apiFetch={apiFetch} onUserUpdate={setAuthUser} /> : null}
                        {route === 'release-notes' ? <ReleaseNotesPage releases={releaseNotes} onBack={() => navigate('dashboard')} /> : null}
                        {route === 'settings' && authUser.role === 'admin' ? <SettingsPage apiFetch={apiFetch} onBack={() => navigate('dashboard')} /> : null}
                        {route === 'schedule' && authUser.role === 'admin' ? <SchedulePage apiFetch={apiFetch} onBack={() => navigate('dashboard')} /> : null}
                    </div>
                </div>
            </div>
            </SidebarProvider>


            <SyncPanel open={syncOpen} onClose={() => setSyncOpen(false)} onSyncDone={handleSyncDone} onSyncStart={snapshotBeforeSync} apiFetch={apiFetch} />
            <DemoWalkthrough open={demoOpen} onClose={() => setDemoOpen(false)} steps={DEMO_STEPS} />
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
                <Command>
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
                            <CommandItem
                                onSelect={() => {
                                    setCommandOpen(false);
                                    navigate('tenders');
                                    setDemoOpen(true);
                                }}
                            >
                                <CircleHelp />
                                <span>Show me around</span>
                            </CommandItem>
                        </CommandGroup>
                        <CommandGroup heading="Preferences">
                            <CommandItem
                                onSelect={() => {
                                    const order = ['light', 'dark', 'system'];
                                    const next = order[(order.indexOf(theme) + 1) % order.length];
                                    setTheme(next);
                                    setCommandOpen(false);
                                }}
                            >
                                <SunMoon />
                                <span>Toggle theme ({resolvedTheme} · {theme})</span>
                            </CommandItem>
                        </CommandGroup>
                    </CommandList>
                </Command>
            </CommandDialog>
        </div>
    );
}
