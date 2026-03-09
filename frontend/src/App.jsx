
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import ProjectTable from './components/ProjectTable';
import SyncPanel from './components/SyncPanel';
import ConfigPanel from './components/ConfigPanel';
import SchedulePanel from './components/SchedulePanel';
import { HomeLine, Shield01, User01, LogOut01, Menu02, X, Mail01, Lock01, Edit01, Key01, UserX01, UserCheck01, SearchLg, Settings01, Clock, RefreshCw01 } from '@untitledui/icons';
import { Button } from '@/components/base/buttons/button';
import { Input } from '@/components/base/input/input';
import { InputBase } from '@/components/base/input/input';
import { Toggle } from '@/components/base/toggle/toggle';
import { Select } from '@/components/base/select/select';
import { TextArea } from '@/components/base/textarea/textarea';
import { ModalOverlay, Modal, Dialog } from '@/components/application/modals/modal';
import { Table } from '@/components/application/table/table';
import { Dropdown } from '@/components/base/dropdown/dropdown';

const API = '/api';

function buildNotificationStreamUrl() {
    const token = localStorage.getItem('pw_access_token');
    const params = new URLSearchParams();
    if (token) params.set('access_token', token);
    const query = params.toString();
    return query ? `${API}/notifications/stream?${query}` : `${API}/notifications/stream`;
}

function normalizeRoute(rawRoute = '') {
    return rawRoute === 'comments' ? 'dashboard' : (rawRoute || 'dashboard');
}

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

const BOOLEAN_QUERY_FIELDS = new Set(['source', 'decision', 'region', 'continent', 'verified', 'ai', 'country', 'keyword', 'signals', 'id', 'published_date', 'deadline', 'last_scraped']);

function tokenizeBooleanQuery(input) {
    const source = String(input || '');
    const tokens = [];
    let index = 0;

    while (index < source.length) {
        const char = source[index];
        if (/\s/.test(char)) {
            index += 1;
            continue;
        }
        if (char === '(') {
            tokens.push({ type: 'LPAREN' });
            index += 1;
            continue;
        }
        if (char === ')') {
            tokens.push({ type: 'RPAREN' });
            index += 1;
            continue;
        }

        const operatorMatch = source.slice(index).match(/^(AND|OR|NOT)\b/i);
        if (operatorMatch) {
            tokens.push({ type: operatorMatch[1].toUpperCase() });
            index += operatorMatch[0].length;
            continue;
        }

        const fieldMatch = source.slice(index).match(/^([a-z_][a-z0-9_]*)\s*:/i);
        if (!fieldMatch) {
            throw new Error(`Unexpected token near "${source.slice(index, index + 16)}"`);
        }

        const field = fieldMatch[1].toLowerCase();
        if (!BOOLEAN_QUERY_FIELDS.has(field)) {
            throw new Error(`Unknown field "${field}"`);
        }
        index += fieldMatch[0].length;

        while (index < source.length && /\s/.test(source[index])) index += 1;

        let value = '';
        if (source[index] === '"') {
            index += 1;
            const start = index;
            while (index < source.length && source[index] !== '"') index += 1;
            if (index >= source.length) throw new Error('Missing closing quote in advanced query');
            value = source.slice(start, index);
            index += 1;
        } else {
            const start = index;
            while (index < source.length && !/[\s()]/.test(source[index])) index += 1;
            value = source.slice(start, index);
        }

        const normalizedValue = value.trim();
        if (!normalizedValue) throw new Error(`Missing value for "${field}"`);
        tokens.push({ type: 'CONDITION', field, value: normalizedValue });
    }

    return tokens;
}

function parseBooleanQuery(input) {
    const tokens = tokenizeBooleanQuery(input);
    let cursor = 0;

    const peek = () => tokens[cursor];
    const consume = (type) => {
        const token = tokens[cursor];
        if (!token || token.type !== type) {
            throw new Error(type === 'RPAREN' ? 'Missing closing parenthesis' : `Expected ${type}`);
        }
        cursor += 1;
        return token;
    };

    const parsePrimary = () => {
        const token = peek();
        if (!token) throw new Error('Incomplete expression');
        if (token.type === 'CONDITION') {
            cursor += 1;
            return { type: 'condition', field: token.field, value: token.value };
        }
        if (token.type === 'LPAREN') {
            consume('LPAREN');
            const expression = parseOr();
            consume('RPAREN');
            return expression;
        }
        throw new Error(`Unexpected token "${token.type}"`);
    };

    const parseUnary = () => {
        if (peek()?.type === 'NOT') {
            consume('NOT');
            return { type: 'not', node: parseUnary() };
        }
        return parsePrimary();
    };

    const parseAnd = () => {
        let node = parseUnary();
        while (peek()?.type === 'AND') {
            consume('AND');
            node = { type: 'and', left: node, right: parseUnary() };
        }
        return node;
    };

    const parseOr = () => {
        let node = parseAnd();
        while (peek()?.type === 'OR') {
            consume('OR');
            node = { type: 'or', left: node, right: parseAnd() };
        }
        return node;
    };

    if (!tokens.length) return null;
    const ast = parseOr();
    if (cursor < tokens.length) {
        throw new Error(`Unexpected token "${tokens[cursor].type}"`);
    }
    return ast;
}

function evaluateBooleanQuery(ast, evaluateCondition) {
    if (!ast) return true;
    if (ast.type === 'condition') return evaluateCondition(ast);
    if (ast.type === 'not') return !evaluateBooleanQuery(ast.node, evaluateCondition);
    if (ast.type === 'and') return evaluateBooleanQuery(ast.left, evaluateCondition) && evaluateBooleanQuery(ast.right, evaluateCondition);
    if (ast.type === 'or') return evaluateBooleanQuery(ast.left, evaluateCondition) || evaluateBooleanQuery(ast.right, evaluateCondition);
    return true;
}

function Avatar({ user, size = 34 }) {
    if (user?.avatarUrl) {
        return (
            <img
                className="layout-avatar-image"
                src={user.avatarUrl}
                alt={user.name || 'user'}
                style={{ width: size, height: size }}
            />
        );
    }
    return (
        <div
            className="layout-avatar-fallback"
            style={{ width: size, height: size, background: colorFromSeed(user?.id || user?.email || '') }}
        >
            {initials(user?.name || '', user?.email || '')}
        </div>
    );
}

function LoginPage({ onLogin, error, bootstrap }) {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');

    return (
        <div className="auth-wrap">
            <form
                className="auth-card"
                onSubmit={(e) => {
                    e.preventDefault();
                    onLogin(email, password);
                }}
            >
                <div className="auth-logo-row">
                    <img src="/forvis-mazars-logo.svg" alt="Forvis Mazars" className="auth-logo" />
                </div>
                <div className="auth-header">
                    <h1 className="auth-title">Welcome back</h1>
                    <p className="auth-subtitle">Sign in to Procurement Watch</p>
                </div>
                {!bootstrap?.hasAdmin ? (
                    <p className="auth-error">No admin user exists. Set ADMIN_EMAIL and ADMIN_PASSWORD, then restart backend.</p>
                ) : null}
                <div className="auth-field">
                    <label className="auth-label" htmlFor="login-email">Email</label>
                    <div className="auth-input-wrap">
                        <Mail01 className="auth-input-icon" />
                        <input
                            id="login-email"
                            name="email"
                            className="auth-input"
                            type="email"
                            placeholder="your@email.com"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                            autoComplete="email"
                        />
                    </div>
                </div>
                <div className="auth-field">
                    <label className="auth-label" htmlFor="login-password">Password</label>
                    <div className="auth-input-wrap">
                        <Lock01 className="auth-input-icon" />
                        <input
                            id="login-password"
                            name="password"
                            className="auth-input"
                            type="password"
                            placeholder="••••••••"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                            autoComplete="current-password"
                        />
                    </div>
                </div>
                {error ? <p className="auth-error">{error}</p> : null}
                <button type="submit" className="auth-submit-btn">Sign In</button>
            </form>
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

    return (
        <div className="auth-wrap force-password-shell">
            <form
                className="auth-card force-password-card"
                onSubmit={(e) => {
                    e.preventDefault();
                    if (canSubmit) onSubmit(newPassword);
                }}
            >
                <div className="force-password-header">
                    <span className="force-password-eyebrow">Account security</span>
                    <h2 className="force-password-title">Change your password</h2>
                    <p className="force-password-copy">For security reasons, you must set a new password before continuing.</p>
                </div>

                <div className="force-password-fields">
                    <div className="force-password-field">
                        <label className="force-password-label" htmlFor="force-password-new">New password</label>
                        <div className="force-password-input-wrap">
                            <input
                                id="force-password-new"
                                name="newPassword"
                                className="force-password-input"
                                type={showNewPassword ? 'text' : 'password'}
                                minLength={8}
                                placeholder="Enter a new password"
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                                autoComplete="new-password"
                                required
                            />
                            <button
                                type="button"
                                className="force-password-toggle"
                                onClick={() => setShowNewPassword((value) => !value)}
                                aria-label={showNewPassword ? 'Hide new password' : 'Show new password'}
                            >
                                {showNewPassword ? 'Hide' : 'Show'}
                            </button>
                        </div>
                        <span className={`force-password-hint is-${passwordStrength.tone}`}>{passwordStrength.label}</span>
                    </div>

                    <div className="force-password-field">
                        <label className="force-password-label" htmlFor="force-password-confirm">Confirm password</label>
                        <div className="force-password-input-wrap">
                            <input
                                id="force-password-confirm"
                                name="confirmPassword"
                                className="force-password-input"
                                type={showConfirmPassword ? 'text' : 'password'}
                                minLength={8}
                                placeholder="Re-enter the new password"
                                value={confirm}
                                onChange={(e) => setConfirm(e.target.value)}
                                autoComplete="new-password"
                                required
                            />
                            <button
                                type="button"
                                className="force-password-toggle"
                                onClick={() => setShowConfirmPassword((value) => !value)}
                                aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
                            >
                                {showConfirmPassword ? 'Hide' : 'Show'}
                            </button>
                        </div>
                        {passwordMismatch ? <p className="force-password-error">Passwords do not match.</p> : <span className="force-password-hint">Use the same password in both fields.</span>}
                    </div>
                </div>

                {error ? <p className="force-password-error">{error}</p> : null}

                <button type="submit" className="force-password-submit" disabled={!canSubmit}>
                    Update password
                </button>
            </form>
        </div>
    );
}

function PageHeader({ title, subtitle, action, className = '' }) {
    return (
        <div className={`layout-page-header ${className}`.trim()}>
            <div className="layout-page-title-row">
                <div className="layout-page-header-copy">
                    <h1 className="layout-page-title">{title}</h1>
                </div>
                {action ? <div className="layout-page-header-action">{action}</div> : null}
            </div>
            {subtitle ? <p className="layout-page-subtitle">{subtitle}</p> : null}
        </div>
    );
}

function SidebarIcon({ type }) {
    const Icon = type === 'dashboard'
        ? HomeLine
        : type === 'admin'
            ? Shield01
            : type === 'profile'
                ? User01
                : type === 'logout'
                    ? LogOut01
                    : null;

    return Icon ? <Icon className="layout-nav-svg" /> : null;
}
function Sidebar({ user, route, onNavigate, collapsed, mobileOpen, onToggleCollapse, onCloseMobile }) {
    const navItems = [
        { key: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
        ...(user?.role === 'admin' ? [{ key: 'admin', label: 'Admin', icon: 'admin' }] : []),
        { key: 'profile', label: 'Profile', icon: 'profile' },
        { key: 'logout', label: 'Logout', icon: 'logout' },
    ];

    return (
        <aside className={`layout-sidebar ${collapsed ? 'collapsed' : ''} ${mobileOpen ? 'open' : ''}`}>
            <div className="layout-sidebar-top">
                <div className="layout-brand-card">
                    <div className="layout-logo-row">
                        <div className="layout-logo-mark">
                            <img className="logo-img" src="/forvis-mazars-logo.svg" alt="Forvis Mazars" />
                        </div>
                        {!collapsed ? (
                            <div className="layout-brand-copy">
                                <span className="layout-brand-kicker">Forvis Mazars</span>
                                <span className="layout-brand-name">Procurement Watch</span>
                            </div>
                        ) : null}
                    </div>
                    <button
                        className="header-icon-btn layout-sidebar-toggle"
                        onClick={onToggleCollapse}
                        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                    >
                        <Menu02 className="layout-topbar-icon" />
                    </button>
                </div>
            </div>

            <nav className="layout-sidebar-nav">
                {navItems.map((item) => (
                    <button
                        key={item.key}
                        className={`layout-nav-item ${route === item.key ? 'active' : ''}`}
                        title={collapsed ? item.label : ""}
                        onClick={() => {
                            onNavigate(item.key);
                            onCloseMobile();
                        }}
                    >
                        <span className="layout-nav-icon" aria-hidden="true"><SidebarIcon type={item.icon} /></span>
                        <span className="layout-nav-label">{item.label}</span>
                    </button>
                ))}
            </nav>

            <div className="layout-sidebar-footer">
                <div className="layout-sidebar-account">
                    <Avatar user={user} size={40} />
                    {!collapsed ? (
                        <div className="layout-sidebar-account-copy">
                            <strong>{user?.name}</strong>
                            <p>{user?.role}</p>
                        </div>
                    ) : null}
                </div>
            </div>
        </aside>
    );
}
function CommentsPanel({ open, entity, project, projectRegion, comments, mine, setMine, body, setBody, onSubmit, onClose, currentUser, apiFetch, onDecisionChange, onDeadlineSave }) {
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
        }
    }, [open, entity?.id, project?.manual_deadline]);

    useEffect(() => {
        const el = textAreaRef.current;
        if (!el) return;
        el.style.height = '42px';
        const nextHeight = Math.min(Math.max(el.scrollHeight, 42), 132);
        el.style.height = `${nextHeight}px`;
        el.style.overflowY = el.scrollHeight > 132 ? 'auto' : 'hidden';
    }, [body]);

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
    const canEditDeadline = currentUser?.role === 'admin';
    const effectiveDeadline = project?.effective_deadline || project?.manual_deadline || project?.scraped_deadline || project?.project_end_date || '';

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if ((body.trim() || pendingFiles.length) && entity?.id) handleSubmit();
        }
    };

    const handleSubmit = () => onSubmit(pendingFiles, () => setPendingFiles([]));

    const handleDeadlineSave = async () => {
        if (!canEditDeadline) return;
        setSavingDeadline(true);
        try {
            await onDeadlineSave(deadlineInput || null);
        } finally {
            setSavingDeadline(false);
        }
    };

    const handleFileChange = async (e) => {
        const files = Array.from(e.target.files || []);
        if (!files.length || !entity?.id) return;
        setUploading(true);
        try {
            for (const file of files) {
                const fd = new FormData();
                fd.append('entityType', entity.type || 'project');
                fd.append('entityId', entity.id);
                fd.append('file', file);
                const res = await apiFetch('/api/comments/upload', {
                    method: 'POST',
                    body: fd,
                });
                if (res.ok) {
                    const att = await res.json();
                    setPendingFiles((prev) => [...prev, att]);
                }
            }
        } finally {
            setUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const removeFile = (fileId) => setPendingFiles((prev) => prev.filter((f) => f.fileId !== fileId));

    const filteredComments = search
        ? comments.filter((c) => {
            const q = search.toLowerCase();
            if ((c.body || '').toLowerCase().includes(q)) return true;
            return (c.attachments || []).some((a) => (a.originalName || '').toLowerCase().includes(q));
        })
        : comments;

    return (
        <div className="project-drawer-backdrop" onClick={onClose}>
            <aside className="project-drawer" onClick={(e) => e.stopPropagation()}>
                <div className="project-drawer-head">
                    <div>
                        <span className="project-inspector-kicker">Project inspector</span>
                        <h2>{projectTitle}</h2>
                    </div>
                    <Button color="tertiary" size="sm" iconLeading={X} onClick={onClose} aria-label="Close project inspector" />
                </div>

                <div className="project-drawer-scroll">
                    <section className="project-inspector-section project-inspector-summary">
                        <div className="project-inspector-badges">
                            <span className={`drawer-chip decision-${(projectDecision || 'pending').toLowerCase().replace(/\s+/g, '-')}`}>
                                {projectDecision || 'Pending'}
                            </span>
                            <span className={`drawer-chip ai-${projectVerified ? 'yes' : 'no'}`}>
                                {projectVerified ? 'Verified' : 'Not verified'}
                            </span>
                            {project?.source ? <span className="drawer-chip neutral">{project.source}</span> : null}
                        </div>

                        {projectDescription ? (
                            <div className="project-inspector-description">
                                <h3>Description</h3>
                                <p>{projectDescription}</p>
                            </div>
                        ) : null}

                        <div className="inspector-decision-block">
                            <div>
                                <h3>Decision</h3>
                                <p>Update the analyst call without leaving the review flow.</p>
                            </div>
                            <div className="inspector-decision-actions">
                                <button
                                    type="button"
                                    className={`inspector-decision-btn ${projectDecision === 'Go' ? 'is-active is-go' : ''}`}
                                    onClick={() => onDecisionChange(projectDecision === 'Go' ? '' : 'Go')}
                                >
                                    Go
                                </button>
                                <button
                                    type="button"
                                    className={`inspector-decision-btn ${projectDecision === 'No Go' ? 'is-active is-nogo' : ''}`}
                                    onClick={() => onDecisionChange(projectDecision === 'No Go' ? '' : 'No Go')}
                                >
                                    No Go
                                </button>
                                <button
                                    type="button"
                                    className={`inspector-decision-btn ${!projectDecision ? 'is-active' : ''}`}
                                    onClick={() => onDecisionChange('')}
                                >
                                    Undecided
                                </button>
                            </div>
                        </div>

                        <div className="project-inspector-grid">
                            <div><span>ID</span><strong>{project?.project_id || '-'}</strong></div>
                            <div><span>Region</span><strong>{projectRegion || '-'}</strong></div>
                            <div><span>Sponsor</span><strong>{project?.project_sponsor || '-'}</strong></div>
                            <div><span>Start date</span><strong>{formatDisplayDate(project?.project_start_date)}</strong></div>
                            <div><span>Deadline</span><strong>{formatDisplayDate(effectiveDeadline)}</strong></div>
                            <div><span>Source</span><strong>{project?.source || '-'}</strong></div>
                            <div><span>Deadline source</span><strong>{project?.deadline_source || '-'}</strong></div>
                            <div><span>Scraped deadline</span><strong>{formatDisplayDate(project?.scraped_deadline || project?.project_end_date)}</strong></div>
                            <div><span>Manual deadline</span><strong>{formatDisplayDate(project?.manual_deadline)}</strong></div>
                        </div>

                        <div className="project-inspector-deadline-editor">
                            <div>
                                <h3>Manual deadline</h3>
                                <p>{canEditDeadline ? 'Override the scraped deadline when analyst review requires a correction.' : 'Only admins can edit the deadline.'}</p>
                            </div>
                            <div className="project-inspector-deadline-form">
                                <input
                                    type="date"
                                    name="manualDeadline"
                                    aria-label="Manual deadline"
                                    value={deadlineInput}
                                    onChange={(e) => setDeadlineInput(e.target.value)}
                                    disabled={!canEditDeadline || savingDeadline}
                                />
                                <button
                                    type="button"
                                    className="profile-btn profile-btn-primary"
                                    onClick={handleDeadlineSave}
                                    disabled={!canEditDeadline || savingDeadline}
                                >
                                    {savingDeadline ? 'Saving...' : 'Save deadline'}
                                </button>
                            </div>
                            {project?.deadline_updated_by || project?.deadline_updated_at ? (
                                <p className="project-inspector-deadline-meta">
                                    {project?.deadline_updated_by ? `Updated by ${project.deadline_updated_by}` : 'Deadline updated'}
                                    {project?.deadline_updated_at ? ` on ${formatDisplayDate(project.deadline_updated_at)}` : ''}
                                </p>
                            ) : null}
                        </div>

                        <div className="project-inspector-links">
                            <h3>Links</h3>
                            <div className="project-inspector-link-list">
                                {project?.project_url ? <a href={project.project_url} target="_blank" rel="noreferrer">Open source listing</a> : <span>No project link</span>}
                                {project?.document_url ? <a href={project.document_url} target="_blank" rel="noreferrer">Open document</a> : <span>No document link</span>}
                            </div>
                        </div>

                        {keywords.length > 0 ? (
                            <div className="project-inspector-keywords">
                                <h3>Signals</h3>
                                <div className="comments-keywords">
                                    {keywords.map((kw) => (
                                        <span key={kw} className="keyword-tag">{kw}</span>
                                    ))}
                                </div>
                            </div>
                        ) : null}
                    </section>

                    <section className="project-inspector-section project-inspector-discussion">
                        <div className="project-discussion-header">
                            <div className="project-discussion-title-row">
                                <div>
                                    <span className="project-discussion-title">Discussion</span>
                                    <span className="project-discussion-meta">{comments.length} notes</span>
                                </div>
                                <button
                                    type="button"
                                    className={`chat-tool-btn ${searchOpen ? 'is-active' : ''}`}
                                    aria-label={searchOpen ? 'Hide message search' : 'Search messages'}
                                    onClick={() => {
                                        if (searchOpen && !search) {
                                            setSearchOpen(false);
                                            return;
                                        }
                                        setSearchOpen((prev) => !prev);
                                    }}
                                >
                                    <SearchLg className="chat-tool-icon" />
                                </button>
                            </div>
                            <div className={`project-discussion-search ${searchOpen ? 'is-open' : ''}`}>
                                <input
                                    className="chat-search-input compact"
                                    type="text"
                                    name="discussionSearch"
                                    aria-label="Search discussion messages"
                                    placeholder="Search messages..."
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                />
                            </div>
                        </div>

                        <div className="comments-drawer-list chat-list inspector-chat-list" ref={listRef}>
                            {!entity?.id ? <p className="auth-muted">No entity selected.</p> : null}
                            {entity?.id && filteredComments.length === 0 ? <p className="auth-muted chat-empty">{search ? 'No messages match your search.' : 'No discussion yet. Add the first analyst note.'}</p> : null}
                            {filteredComments.map((c) => {
                                const isMe = c.authorName === currentUserName;
                                const ts = new Date(c.createdAt);
                                const timeStr = ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                                const dateStr = ts.toLocaleDateString([], { month: 'short', day: 'numeric' });
                                return (
                                    <div key={c.id} className={`chat-bubble ${isMe ? 'chat-mine' : 'chat-theirs'}`}>
                                        {!isMe ? (
                                            <div className="chat-avatar" style={{ background: colorFromSeed(c.authorName || '') }}>
                                                {initials(c.authorName || '', '')}
                                            </div>
                                        ) : null}
                                        <div className="chat-content">
                                            {!isMe ? <span className="chat-author">{c.authorName}</span> : null}
                                            <div className="chat-body">
                                                {c.body ? <p>{c.body}</p> : null}
                                                {(c.attachments || []).map((att) => (
                                                    <a key={att.fileId} className="chat-attachment" href={att.url} target="_blank" rel="noreferrer" download={att.originalName}>
                                                        {att.originalName}
                                                    </a>
                                                ))}
                                            </div>
                                            <span className="chat-time">{dateStr}{" "}{timeStr}</span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {pendingFiles.length > 0 ? (
                            <div className="chat-pending-files project-drawer-pending-files">
                                {pendingFiles.map((f) => (
                                    <span key={f.fileId} className="chat-file-chip">
                                        {f.originalName}
                                        <button className="chat-file-remove" onClick={() => removeFile(f.fileId)} title="Remove">x</button>
                                    </span>
                                ))}
                            </div>
                        ) : null}

                        <div className={`project-inspector-compose ${composerFocused || body.trim() ? 'is-focused' : ''}`}>
                            <input ref={fileInputRef} type="file" name="discussionAttachments" multiple style={{ display: 'none' }} onChange={handleFileChange} />
                            <button
                                type="button"
                                className="chat-tool-btn"
                                onClick={() => fileInputRef.current?.click()}
                                disabled={uploading}
                                title="Attach file"
                            >+</button>
                            <textarea
                                ref={textAreaRef}
                                className="chat-input project-chat-input"
                                name="discussionMessage"
                                aria-label="Discussion message"
                                value={body}
                                onChange={(e) => setBody(e.target.value)}
                                onKeyDown={handleKeyDown}
                                onFocus={() => setComposerFocused(true)}
                                onBlur={() => setComposerFocused(Boolean(body.trim()))}
                                placeholder="Type a message..."
                                rows={1}
                            />
                            <button
                                type="button"
                                className="chat-send-btn chat-send-btn-icon"
                                onClick={handleSubmit}
                                disabled={(!body.trim() && !pendingFiles.length) || !entity?.id || uploading}
                                title="Send"
                            >
                                {'>'}
                            </button>
                        </div>
                    </section>
                </div>
            </aside>
        </div>
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

            <div className="profile-layout">
                <aside className="panel-card profile-summary-card">
                    <div className="profile-summary-header">
                        <div
                            className="profile-summary-avatar"
                            style={avatarUrl
                                ? { backgroundImage: `url(${avatarUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
                                : { background: colorFromSeed(name || email) }}
                            aria-hidden="true"
                        >
                            {!avatarUrl ? <span className="profile-summary-avatar-text">{initials(name, email)}</span> : null}
                        </div>
                        <div className="profile-summary-copy">
                            <h2 className="profile-summary-name">{name}</h2>
                            <div className="profile-summary-secondary">
                                <span className={`profile-summary-role-badge ${user?.role === 'admin' ? 'badge-admin' : 'badge-user'}`}>
                                    {user?.role === 'admin' ? 'Admin' : 'User'}
                                </span>
                            </div>
                            <p className="profile-summary-email">{email || 'No email address'}</p>
                        </div>
                    </div>

                    <dl className="profile-summary-meta">
                        <div className="profile-summary-meta-row">
                            <dt className="profile-summary-meta-label">Status</dt>
                            <dd className={`profile-summary-status ${user?.isActive !== false ? 'is-active' : 'is-inactive'}`}>
                                <span className="profile-summary-status-dot" />
                                {user?.isActive !== false ? 'Active' : 'Inactive'}
                            </dd>
                        </div>
                        <div className="profile-summary-meta-row">
                            <dt className="profile-summary-meta-label">Domain</dt>
                            <dd className="profile-summary-meta-value">{emailDomain}</dd>
                        </div>
                        <div className="profile-summary-meta-row">
                            <dt className="profile-summary-meta-label">Role</dt>
                            <dd className="profile-summary-meta-value" style={{ textTransform: 'capitalize' }}>{user?.role || 'user'}</dd>
                        </div>
                    </dl>
                </aside>

                <div className="profile-content-column">
                    <section className="panel-card profile-settings-card">
                        <div className="profile-card-head">
                            <div>
                                <h3>Personal information</h3>
                                <p className="profile-card-description">Update your account details and public profile image.</p>
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
                                <div className="auth-field profile-field-span-2">
                                    <label className="auth-label" htmlFor="prof-avatar">Avatar URL</label>
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

                    <section className="panel-card profile-settings-card">
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

function AdminPage({ apiFetch }) {
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

    useEffect(() => {
        loadUsers();
    }, [loadUsers]);

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
        { key: '_lastLogin', label: 'Last Login', type: 'date' },
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
                case '_lastLogin': valA = a.lastLoginAt || ''; valB = b.lastLoginAt || ''; break;
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

    return (
        <div className="layout-stack admin-users-page">
            <PageHeader
                title="User Management"
                subtitle="Create, edit, deactivate users, and reset passwords."
                action={(
                    <div className="admin-users-header-actions">
                        <button
                            type="button"
                            className="profile-btn profile-btn-primary admin-toolbar-btn admin-users-create-btn"
                            disabled={savingDrawer}
                            onClick={() => setDrawer({ open: true, mode: 'create', user: null })}
                        >
                            Create User
                        </button>
                    </div>
                )}
            />

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
                                                    {u.role === 'admin' ? 'Admin' : 'User'}
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
                                    if (key === '_lastLogin') {
                                        return <Table.Cell><span className="admin-users-last-login">{formatAdminDateTime(u.lastLoginAt)}</span></Table.Cell>;
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
    const [advancedQuery, setAdvancedQuery] = useState(() => {
        try {
            return sessionStorage.getItem('pw_advanced_query') || '';
        } catch {
            return '';
        }
    });
    const [advancedQueryEnabled, setAdvancedQueryEnabled] = useState(() => {
        try {
            return sessionStorage.getItem('pw_advanced_query_enabled') === '1';
        } catch {
            return false;
        }
    });
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

    const [authUser, setAuthUser] = useState(null);
    const [authError, setAuthError] = useState('');
    const [mustChangeError, setMustChangeError] = useState('');
    const [bootstrapStatus, setBootstrapStatus] = useState(null);

    const [route, setRoute] = useState(normalizeRoute(window.location.hash.replace('#', '')));
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const [mobileNavOpen, setMobileNavOpen] = useState(false);
    const [commentsOpen, setCommentsOpen] = useState(false);
    const [selectedProject, setSelectedProject] = useState(null);
    const [selectedProjectIndex, setSelectedProjectIndex] = useState(null);
    const [commentsMine, setCommentsMine] = useState(false);
    const [commentsBody, setCommentsBody] = useState('');
    const [comments, setComments] = useState([]);
    const [syncOpen, setSyncOpen] = useState(false);
    const [configOpen, setConfigOpen] = useState(false);
    const [scheduleOpen, setScheduleOpen] = useState(false);
    const preSyncIdsRef = useRef(new Set());
    const notificationAudioRef = useRef(null);
    const notificationStreamRef = useRef(null);
    const notificationAudioUnlockedRef = useRef(false);

    useEffect(() => {
        try {
            sessionStorage.setItem('pw_advanced_query', advancedQuery);
            sessionStorage.setItem('pw_advanced_query_enabled', advancedQueryEnabled ? '1' : '0');
        } catch {
            // Ignore sessionStorage access issues.
        }
    }, [advancedQuery, advancedQueryEnabled]);

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
        const onHash = () => setRoute(normalizeRoute(window.location.hash.replace('#', '')));
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

    const loadProjects = useCallback(async () => {
        const res = await apiFetch(`${API}/projects`);
        const data = await res.json();
        setProjects(attachProjectRowIds(Array.isArray(data) ? data : []));
    }, [apiFetch]);

    useEffect(() => {
        if (!authUser || authUser.mustChangePassword) return;
        loadProjects();
        Promise.all([
            apiFetch('/api/config').then((r) => (r.ok ? r.json() : { regions: {} })),
            apiFetch('/api/geography').then((r) => (r.ok ? r.json() : { continents: [] })),
        ])
            .then(([cfg, geography]) => {
                setRegions(cfg.regions || {});
                setContinents(geography.continents || []);
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

    const getRegion = useCallback((sponsor) => {
        if (!sponsor) return '';
        const lower = sponsor.toLowerCase();
        for (const [regionName, countries] of Object.entries(regions || {})) {
            if (countries.some((c) => lower.includes(c.toLowerCase()))) return regionName;
        }
        return '';
    }, [regions]);

    const advancedQueryResult = useMemo(() => {
        const query = advancedQuery.trim();
        if (!advancedQueryEnabled || !query) return { ast: null, error: '' };
        try {
            return { ast: parseBooleanQuery(query), error: '' };
        } catch (error) {
            return { ast: null, error: error.message || 'Invalid advanced query' };
        }
    }, [advancedQuery, advancedQueryEnabled]);

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
            const scrapedAt = parseFilterDate(p.scraped_at);
            if (scrapedFromDate && (!scrapedAt || scrapedAt < scrapedFromDate)) return false;
            if (scrapedToDate && (!scrapedAt || scrapedAt > scrapedToDate)) return false;
            if (advancedQueryEnabled && advancedQuery.trim() && !advancedQueryResult.error) {
                const projectRegions = (p.region_names || []).map((name) => String(name).toLowerCase());
                const projectContinents = [
                    ...(p.continent_codes || []).map((code) => String(code).toLowerCase()),
                    ...(p.continent_names_en || []).map((name) => String(name).toLowerCase()),
                    ...(p.continent_names_fr || []).map((name) => String(name).toLowerCase()),
                ];
                const projectCountries = [
                    ...(p.country_names_en || []).map((name) => String(name).toLowerCase()),
                    ...(p.country_names_fr || []).map((name) => String(name).toLowerCase()),
                    String(p.project_sponsor || '').toLowerCase(),
                ];
                const projectKeywords = String(p.matched_keywords || '')
                    .split(',')
                    .map((keywordValue) => keywordValue.trim().toLowerCase())
                    .filter(Boolean);
                const isVerified = p.ai_verified === 'Yes';
                const normalizedDecision = p.decision ? String(p.decision).toLowerCase() : 'undecided';
                const matchesAdvancedCondition = ({ field, value }) => {
                    const queryValue = String(value || '').toLowerCase();
                    switch (field) {
                        case 'source':
                            return String(p.source || '').toLowerCase().includes(queryValue);
                        case 'decision':
                            return normalizedDecision === queryValue;
                        case 'region':
                            return projectRegions.some((regionValue) => regionValue.includes(queryValue));
                        case 'continent':
                        case 'country':
                            return (field === 'continent' ? projectContinents : projectCountries)
                                .some((entry) => entry.includes(queryValue));
                        case 'verified':
                        case 'ai': {
                            const positive = ['yes', 'true', 'verified', '1'];
                            const negative = ['no', 'false', 'unverified', '0'];
                            if (positive.includes(queryValue)) return isVerified;
                            if (negative.includes(queryValue)) return !isVerified;
                            return false;
                        }
                        case 'keyword':
                        case 'signals':
                            return projectKeywords.some((keywordValue) => keywordValue.includes(queryValue));
                        case 'id':
                            return String(p.project_id || '').toLowerCase().includes(queryValue);
                        case 'published_date':
                            return [
                                String(p.project_start_date || '').toLowerCase(),
                                formatDisplayDate(p.project_start_date).toLowerCase(),
                            ].some((entry) => entry.includes(queryValue));
                        case 'deadline': {
                            const deadlineValue = p.effective_deadline || p.manual_deadline || p.scraped_deadline || p.project_end_date || '';
                            return [
                                String(deadlineValue).toLowerCase(),
                                formatDisplayDate(deadlineValue).toLowerCase(),
                            ].some((entry) => entry.includes(queryValue));
                        }
                        case 'last_scraped':
                            return [
                                String(p.scraped_at || '').toLowerCase(),
                                formatDisplayDate(p.scraped_at).toLowerCase(),
                            ].some((entry) => entry.includes(queryValue));
                        default:
                            return false;
                    }
                };
                if (!evaluateBooleanQuery(advancedQueryResult.ast, matchesAdvancedCondition)) return false;
            }
            return true;
        });
    }, [projects, chips, freeText, source, verified, region, continent, regions, decision, endDateFrom, endDateTo, scrapedFrom, scrapedTo, getRegion, advancedQueryEnabled, advancedQuery, advancedQueryResult]);

    const sources = useMemo(() => [...new Set(projects.map((p) => p.source).filter(Boolean))].sort(), [projects]);

    const clearFilters = () => {
        setChips([]);
        setFreeText('');
        setAdvancedQuery('');
        setAdvancedQueryEnabled(false);
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
    };

    const handleDecisionChange = async (index, nextDecision) => {
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

    const submitComment = async (pendingFiles = [], onFilesClear = null) => {
        if ((!commentsBody.trim() && !pendingFiles.length) || !selectedEntityId) return;
        const attachments = pendingFiles || [];
        const optimistic = {
            id: `tmp-${Date.now()}`,
            authorName: authUser?.name || 'You',
            body: commentsBody.trim(),
            attachments,
            createdAt: new Date().toISOString(),
        };
        setComments((prev) => [...prev, optimistic]);
        const text = commentsBody;
        setCommentsBody('');
        if (onFilesClear) onFilesClear();
        await apiFetch('/api/comments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ entityType: selectedEntityType, entityId: selectedEntityId, body: text || ' ', attachments }),
        });
        await refreshComments();
    };

    const clearActiveProject = useCallback(() => {
        setSelectedProject(null);
        setSelectedProjectIndex(null);
        setCommentsOpen(false);
    }, []);

    const navigate = (key) => {
        if (key === 'logout') {
            doLogout();
            return;
        }
        setRoute(key);
        window.location.hash = `#${key}`;
    };

    if (loading) return <div className="app"><div className="loading"><div className="spinner" /><p>Loading...</p></div></div>;
    if (!authUser) return <LoginPage onLogin={doLogin} error={authError} bootstrap={bootstrapStatus} />;
    if (authUser.mustChangePassword) return <ForcePasswordPage onSubmit={doChangePassword} error={mustChangeError} />;

    return (
        <div className="layout-root">
            <Sidebar
                user={authUser}
                route={route}
                onNavigate={navigate}
                collapsed={sidebarCollapsed}
                mobileOpen={mobileNavOpen}
                onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
                onCloseMobile={() => setMobileNavOpen(false)}
            />
            <div className="layout-main">
                <div className="layout-page-scroll">
                    <div className="layout-shell-container layout-page-container">
                        {route === 'dashboard' ? (
                            <div className="layout-dashboard layout-content-row">
                                <div className="layout-dashboard-main">
                                    <PageHeader
                                        title="Procurement Watch"
                                        subtitle="Track tenders, review sources, and manage decisions."
                                        className="layout-page-header-compact"
                                        action={(
                                            <div className="header-actions dashboard-header-actions">
                                                <div className="header-buttons dashboard-header-buttons">
                                                    <button type="button" className="header-tertiary-btn" onClick={() => setConfigOpen(true)}>
                                                        <Settings01 className="header-btn-icon" />
                                                        <span>Settings</span>
                                                    </button>
                                                    <button type="button" className="header-secondary-btn" onClick={() => setScheduleOpen(true)}>
                                                        <Clock className="header-btn-icon" />
                                                        Schedule
                                                    </button>
                                                    <button type="button" className="sync-btn" onClick={() => setSyncOpen(true)}>
                                                        <RefreshCw01 className="header-btn-icon" />
                                                        Sync
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    />
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
                                        advancedQuery={advancedQuery}
                                        onAdvancedQueryChange={setAdvancedQuery}
                                        advancedQueryEnabled={advancedQueryEnabled}
                                        onAdvancedQueryEnabledChange={setAdvancedQueryEnabled}
                                        advancedQueryError={advancedQueryResult.error}
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
                                        activeProjectId={selectedEntityId}
                                        onClearActiveProject={clearActiveProject}
                                        onProjectSelect={(project, projectIndex) => {
                                            setSelectedProject(project);
                                            setSelectedProjectIndex(projectIndex);
                                            setCommentsOpen(true);
                                        }}
                                    />
                                </div>
                            </div>
                        ) : null}

                        {route === 'admin' && authUser.role === 'admin' ? <AdminPage apiFetch={apiFetch} /> : null}
                        {route === 'profile' ? <ProfilePage user={authUser} apiFetch={apiFetch} onUserUpdate={setAuthUser} /> : null}
                    </div>
                </div>
            </div>

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
                onDecisionChange={(nextDecision) => {
                    if (selectedProjectIndex !== null) handleDecisionChange(selectedProjectIndex, nextDecision);
                }}
                onDeadlineSave={(nextDeadline) => {
                    if (selectedProjectIndex !== null) return handleDeadlineChange(selectedProjectIndex, nextDeadline);
                    return Promise.resolve();
                }}
            />

            <SyncPanel open={syncOpen} onClose={() => setSyncOpen(false)} onSyncDone={handleSyncDone} onSyncStart={snapshotBeforeSync} apiFetch={apiFetch} />
            <ConfigPanel open={configOpen} onClose={() => setConfigOpen(false)} apiFetch={apiFetch} />
            <SchedulePanel open={scheduleOpen} onClose={() => setScheduleOpen(false)} apiFetch={apiFetch} />
        </div>
    );
}





