
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import ProjectTable from './components/ProjectTable';
import SyncPanel from './components/SyncPanel';
import ConfigPanel from './components/ConfigPanel';
import SchedulePanel from './components/SchedulePanel';
import { HomeLine, Shield01, User01, LogOut01, Menu02, Moon01, Sun, X, Mail01, Lock01, Edit01, Key01, UserX01, UserCheck01, SearchLg } from '@untitledui/icons';
import { Button } from '@/components/base/buttons/button';
import { Input } from '@/components/base/input/input';
import { InputBase } from '@/components/base/input/input';
import { Toggle } from '@/components/base/toggle/toggle';
import { Select } from '@/components/base/select/select';
import { TextArea } from '@/components/base/textarea/textarea';
import { Badge, BadgeWithDot } from '@/components/base/badges/badges';
import { ModalOverlay, Modal, Dialog } from '@/components/application/modals/modal';
import { Table } from '@/components/application/table/table';
import { Dropdown } from '@/components/base/dropdown/dropdown';

const API = '/api';

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

    return (
        <div className="auth-wrap">
            <form
                className="auth-card"
                onSubmit={(e) => {
                    e.preventDefault();
                    if (newPassword === confirm) onSubmit(newPassword);
                }}
            >
                <h2>Change Password</h2>
                <p className="auth-error">You must change your password to continue.</p>
                <Input icon={Lock01} type="password" minLength={8} placeholder="New password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} isRequired />
                <Input icon={Lock01} type="password" minLength={8} placeholder="Confirm password" value={confirm} onChange={(e) => setConfirm(e.target.value)} isRequired />
                {confirm && newPassword !== confirm ? <p className="auth-error">Passwords do not match.</p> : null}
                {error ? <p className="auth-error">{error}</p> : null}
                <Button color="primary" type="submit" className="w-full">Update Password</Button>
            </form>
        </div>
    );
}

function PageHeader({ title, subtitle, action }) {
    return (
        <div className="layout-page-header">
            <div>
                <h1 className="layout-page-title">{title}</h1>
                {subtitle ? <p className="layout-page-subtitle">{subtitle}</p> : null}
            </div>
            {action ? <div>{action}</div> : null}
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
                <div className="layout-logo-row">
                    <img className="logo-img" src="/forvis-mazars-logo.svg" alt="Forvis Mazars" />
                    {!collapsed ? <span>Procurement Watch</span> : null}
                </div>
                <button className="header-icon-btn layout-sidebar-toggle" onClick={onToggleCollapse} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>{collapsed ? '>>' : '<<'}</button>
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
                <Avatar user={user} size={36} />
                {!collapsed ? (
                    <div>
                        <strong>{user?.name}</strong>
                        <p>{user?.role}</p>
                    </div>
                ) : null}
            </div>
        </aside>
    );
}

function TopBar({ onOpenMobile, theme, onToggleTheme, user }) {
    return (
        <header className="layout-topbar">
            <div className="layout-shell-container layout-topbar-inner">
                <div className="layout-topbar-left">
                    <button className="header-icon-btn layout-mobile-menu" onClick={onOpenMobile} aria-label="Open sidebar menu">
                        <Menu02 className="layout-topbar-icon" />
                    </button>
                </div>
                <div className="layout-topbar-right">
                    {/*<button
                        className="header-icon-btn theme-toggle-btn"
                        onClick={onToggleTheme}
                        title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                        aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                    >
                        {theme === 'dark' ? <Sun className="layout-topbar-icon" /> : <Moon01 className="layout-topbar-icon" />}
                    </button>*/}
                    <Avatar user={user} size={32} />
                </div>
            </div>
        </header>
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
        if (!open) return undefined;
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
            await onDeadlineSave?.(deadlineInput);
        } finally {
            setSavingDeadline(false);
        }
    };

    const handleFileChange = async (e) => {
        const files = Array.from(e.target.files || []);
        if (!files.length) return;
        setUploading(true);
        try {
            for (const file of files) {
                const fd = new FormData();
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
                                <input type="date" value={deadlineInput} onChange={(e) => setDeadlineInput(e.target.value)} disabled={!canEditDeadline || savingDeadline} />
                                <button type="button" className="inspector-decision-btn" onClick={handleDeadlineSave} disabled={!canEditDeadline || savingDeadline}>
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
                            <input ref={fileInputRef} type="file" multiple style={{ display: 'none' }} onChange={handleFileChange} />
                            <button
                                className="chat-tool-btn"
                                onClick={() => fileInputRef.current?.click()}
                                disabled={uploading}
                                title="Attach file"
                            >+</button>
                            <textarea
                                ref={textAreaRef}
                                className="chat-input project-chat-input"
                                value={body}
                                onChange={(e) => setBody(e.target.value)}
                                onKeyDown={handleKeyDown}
                                onFocus={() => setComposerFocused(true)}
                                onBlur={() => setComposerFocused(Boolean(body.trim()))}
                                placeholder="Type a message..."
                                rows={1}
                            />
                            <button
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
    const displayName = `${firstName} ${lastName}`.trim() || user?.name || 'User';
    const emailDomain = email?.split('@')[1] || 'No domain';
    const passwordMismatch = Boolean(newPassword && newPassword !== confirmPassword);

    const saveProfile = async () => {
        setSavingProfile(true);
        try {
            const name = `${firstName} ${lastName}`.trim();
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
        if (newPassword !== confirmPassword) return;
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
                    <div className="profile-summary-accent" />
                    <div className="profile-summary-header">
                        <div className="profile-summary-avatar">
                            <Avatar user={{ ...user, name: displayName, email, avatarUrl }} size={84} />
                        </div>
                        <div className="profile-summary-copy">
                            <span className="profile-summary-eyebrow">Account</span>
                            <h2 className="profile-summary-name">{displayName}</h2>
                            <span className={`profile-hero-role-badge ${user?.role === 'admin' ? 'badge-admin' : 'badge-user'}`}>
                                {user?.role === 'admin' ? 'Admin' : 'User'}
                            </span>
                            <p className="profile-summary-email">{email || 'No email address'}</p>
                        </div>
                    </div>

                    <div className="profile-summary-meta">
                        <div className="profile-summary-meta-item">
                            <span className="profile-summary-meta-label">Status</span>
                            <span className={`profile-summary-status ${user?.isActive !== false ? 'is-active' : 'is-inactive'}`}>
                                {user?.isActive !== false ? 'Active' : 'Inactive'}
                            </span>
                        </div>
                        <div className="profile-summary-meta-item">
                            <span className="profile-summary-meta-label">Domain</span>
                            <span className="profile-summary-meta-value">{emailDomain}</span>
                        </div>
                        <div className="profile-summary-meta-item">
                            <span className="profile-summary-meta-label">Role</span>
                            <span className="profile-summary-meta-value" style={{ textTransform: 'capitalize' }}>{user?.role || 'user'}</span>
                        </div>
                    </div>
                </aside>

                <div className="profile-content-column">
                    <section className="panel-card profile-settings-card">
                        <div className="profile-card-head">
                            <div>
                                <h3>Personal information</h3>
                                <p className="profile-card-description">Update your account details and public profile image.</p>
                            </div>
                        </div>

                        <div className="profile-settings-grid">
                            <div className="auth-field">
                                <label className="auth-label" htmlFor="prof-firstname">First name</label>
                                <input id="prof-firstname" className="auth-input" placeholder="First name" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                            </div>
                            <div className="auth-field">
                                <label className="auth-label" htmlFor="prof-lastname">Last name</label>
                                <input id="prof-lastname" className="auth-input" placeholder="Last name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
                            </div>
                            <div className="auth-field profile-field-span-2">
                                <label className="auth-label" htmlFor="prof-email">Email</label>
                                <input id="prof-email" className="auth-input" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
                            </div>
                            <div className="auth-field profile-field-span-2">
                                <label className="auth-label" htmlFor="prof-avatar">Avatar URL</label>
                                <input id="prof-avatar" className="auth-input" placeholder="https://..." value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} />
                                <span className="profile-field-hint">Use a direct image link to update the profile photo preview.</span>
                            </div>
                        </div>

                        <div className="profile-card-footer">
                            <button type="button" className="profile-btn profile-btn-secondary" onClick={() => setAvatarUrl('')}>Remove avatar</button>
                            <button type="button" className="profile-btn profile-btn-primary" onClick={saveProfile} disabled={savingProfile}>{savingProfile ? 'Saving...' : 'Save changes'}</button>
                        </div>
                    </section>

                    <section className="panel-card profile-settings-card">
                        <div className="profile-card-head">
                            <div>
                                <h3>Security</h3>
                                <p className="profile-card-description">Change your password and keep your account secure.</p>
                            </div>
                        </div>

                        <div className="profile-password-stack">
                            <div className="auth-field">
                                <label className="auth-label" htmlFor="prof-curpwd">Current password</label>
                                <input id="prof-curpwd" className="auth-input" type="password" placeholder="Current password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
                            </div>
                            <div className="profile-password-grid">
                                <div className="auth-field">
                                    <label className="auth-label" htmlFor="prof-newpwd">New password</label>
                                    <input id="prof-newpwd" className="auth-input" type="password" placeholder="New password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
                                    <span className="profile-field-hint">Minimum 8 characters.</span>
                                </div>
                                <div className="auth-field">
                                    <label className="auth-label" htmlFor="prof-confirmpwd">Confirm new password</label>
                                    <input id="prof-confirmpwd" className="auth-input" type="password" placeholder="Confirm new password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
                                    {passwordMismatch ? <span className="profile-pwd-mismatch">Passwords do not match.</span> : <span className="profile-field-hint">Re-enter the new password to confirm it.</span>}
                                </div>
                            </div>
                        </div>

                        <div className="profile-card-footer profile-card-footer-end">
                            <button
                                type="button"
                                className="profile-btn profile-btn-primary"
                                disabled={savingPassword || !currentPassword || !newPassword || passwordMismatch}
                                onClick={savePassword}
                            >
                                {savingPassword ? 'Saving...' : 'Update password'}
                            </button>
                        </div>
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

    if (!open) return null;

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-card" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h2 className="modal-title">{mode === 'create' ? 'Create User' : 'Edit User'}</h2>
                    <button className="modal-close-btn" onClick={onClose}>×</button>
                </div>

                <div className="modal-body">
                    <div className="modal-grid-2col">
                        <div className="auth-field">
                            <label className="auth-label" htmlFor="ud-first">First name</label>
                            <input id="ud-first" className="auth-input" placeholder="First name" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                        </div>
                        <div className="auth-field">
                            <label className="auth-label" htmlFor="ud-last">Last name</label>
                            <input id="ud-last" className="auth-input" placeholder="Last name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
                        </div>
                    </div>

                    <div className="auth-field">
                        <label className="auth-label" htmlFor="ud-email">Email</label>
                        <input id="ud-email" className="auth-input" type="email" placeholder="user@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
                    </div>

                    <div className="modal-grid-2col">
                        <div className="auth-field">
                            <label className="auth-label" htmlFor="ud-role">Role</label>
                            <select id="ud-role" className="auth-input" value={role} onChange={(e) => setRole(e.target.value)}>
                                <option value="user">User</option>
                                <option value="admin">Admin</option>
                            </select>
                        </div>
                        <div className="auth-field">
                            <label className="auth-label">Status</label>
                            <label className="modal-toggle-row">
                                <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
                                <span className={`modal-toggle-label ${isActive ? 'active' : 'inactive'}`}>{isActive ? 'Active' : 'Disabled'}</span>
                            </label>
                        </div>
                    </div>

                    <div className="auth-field">
                        <label className="auth-label" htmlFor="ud-avatar">Avatar URL</label>
                        <input id="ud-avatar" className="auth-input" placeholder="https://..." value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} />
                    </div>

                    {mode === 'create' && (
                        <div className="auth-field">
                            <label className="auth-label" htmlFor="ud-pwd">Temporary password <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(optional, auto-generated if empty)</span></label>
                            <input id="ud-pwd" className="auth-input" type="password" placeholder="Temporary password" value={tempPassword} onChange={(e) => setTempPassword(e.target.value)} />
                        </div>
                    )}
                </div>

                <div className="modal-footer">
                    <button className="profile-btn profile-btn-secondary" onClick={onClose}>Cancel</button>
                    <button
                        className="profile-btn profile-btn-primary"
                        disabled={saving || !email.trim()}
                        onClick={() => onSave({
                            name: `${firstName} ${lastName}`.trim(),
                            email: email.trim(),
                            role,
                            avatarUrl,
                            password: tempPassword,
                            isActive,
                        })}
                    >
                        {saving ? 'Saving…' : mode === 'create' ? 'Create User' : 'Save Changes'}
                    </button>
                </div>
            </div>
        </div>
    );
}

function ResetPasswordModal({ open, user, onClose, onReset, saving, result }) {
    const [password, setPassword] = useState('');
    useEffect(() => { if (open) setPassword(''); }, [open]);
    if (!open || !user) return null;

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-card modal-card-sm" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h2 className="modal-title">Reset Password</h2>
                    <button className="modal-close-btn" onClick={onClose}>×</button>
                </div>
                <div className="modal-body">
                    <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.88rem' }}>
                        Reset password for <strong>{user.name || user.email}</strong>
                    </p>
                    <div className="auth-field">
                        <label className="auth-label" htmlFor="rp-pwd">New password <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(leave empty to auto-generate)</span></label>
                        <input id="rp-pwd" className="auth-input" type="password" placeholder="Auto-generated if empty" value={password} onChange={(e) => setPassword(e.target.value)} />
                    </div>
                    {result && <p className="profile-success-msg">{result}</p>}
                </div>
                <div className="modal-footer">
                    <button className="profile-btn profile-btn-secondary" onClick={onClose}>Cancel</button>
                    <button className="profile-btn profile-btn-primary" disabled={saving} onClick={() => onReset(password || null)}>
                        {saving ? 'Resetting…' : 'Reset Password'}
                    </button>
                </div>
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

    const loadUsers = useCallback(async () => {
        setRefreshingUsers(true);
        try {
            const res = await apiFetch(`/api/admin/users?q=${encodeURIComponent(q)}`);
            setUsers(await res.json());
        } finally {
            setRefreshingUsers(false);
        }
    }, [apiFetch, q]);

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
        if (!drawer.user?.id) return;
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

    const visibleUsers = useMemo(() => users.filter((u) => {
        if (roleFilter !== 'all' && u.role !== roleFilter) return false;
        if (statusFilter === 'active' && !u.isActive) return false;
        if (statusFilter === 'disabled' && u.isActive) return false;
        return true;
    }), [users, roleFilter, statusFilter]);

    const columns = [
        { key: '_user', label: 'User', type: 'string' },
        { key: '_email', label: 'Email', type: 'string' },
        { key: '_role', label: 'Role', type: 'string' },
        { key: '_status', label: 'Status', type: 'string' },
        { key: '_lastLogin', label: 'Last Login', type: 'date' },
        { key: '_actions', label: '', type: 'none', width: '52px' },
    ];

    const sorted = useMemo(() => {
        if (!sortCol) return visibleUsers;
        return [...visibleUsers].sort((a, b) => {
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
    }, [visibleUsers, sortCol, sortDir]);

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
        <div className="layout-stack">
            <PageHeader
                title="User Management"
                subtitle="Create, edit, deactivate users, and reset passwords."
                action={<Button color="primary" isDisabled={savingDrawer} onPress={() => setDrawer({ open: true, mode: 'create', user: null })}>Create User</Button>}
            />

            <div className="table-wrapper table-surface">
                <div className="table-toolbar">
                    <div className="table-toolbar-row">
                        <Input placeholder="Search name/email" value={q} onChange={(e) => setQ(e.target.value)} />
                        <span className="toolbar-count"><strong>{visibleUsers.length}</strong> users</span>
                    </div>
                    <div className="table-toolbar-row table-toolbar-filters">
                        <select className="filter-select filter-select-compact" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
                            <option value="all">All roles</option>
                            <option value="admin">Admin</option>
                            <option value="user">User</option>
                        </select>
                        <select className="filter-select filter-select-compact" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                            <option value="all">All status</option>
                            <option value="active">Active</option>
                            <option value="disabled">Disabled</option>
                        </select>
                        <Button color="secondary" onPress={loadUsers} isDisabled={refreshingUsers} isLoading={refreshingUsers}>Refresh</Button>
                    </div>
                </div>

                {message ? <p className="auth-muted" style={{ padding: '8px 16px', margin: 0 }}>{message}</p> : null}

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
                                className={!u.isActive ? 'row-disabled-user' : ''}
                            >
                                {(columnKey) => {
                                    const key = typeof columnKey === 'string' ? columnKey : (columnKey?.key || columnKey?.id || '');
                                    if (key === '_user') {
                                        return (
                                            <Table.Cell>
                                                <div className="layout-user-cell">
                                                    <Avatar user={u} size={36} />
                                                    <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{u.name}</span>
                                                </div>
                                            </Table.Cell>
                                        );
                                    }
                                    if (key === '_email') {
                                        return <Table.Cell>{u.email}</Table.Cell>;
                                    }
                                    if (key === '_role') {
                                        return <Table.Cell><Badge color={u.role === 'admin' ? 'brand' : 'gray'}>{u.role}</Badge></Table.Cell>;
                                    }
                                    if (key === '_status') {
                                        return <Table.Cell><BadgeWithDot color={u.isActive ? 'success' : 'gray'}>{u.isActive ? 'Active' : 'Disabled'}</BadgeWithDot></Table.Cell>;
                                    }
                                    if (key === '_lastLogin') {
                                        return <Table.Cell>{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : '—'}</Table.Cell>;
                                    }
                                    return (
                                        <Table.Cell className="td-actions">
                                            <Dropdown.Root>
                                                <Dropdown.DotsButton />
                                                <Dropdown.Popover className="w-min">
                                                    <Dropdown.Menu onAction={(actionKey) => {
                                                        if (actionKey === 'edit') setDrawer({ open: true, mode: 'edit', user: u });
                                                        if (actionKey === 'reset') { setResetResult(''); setResetModal({ open: true, user: u }); }
                                                        if (actionKey === 'toggle') toggleUser(u);
                                                    }}>
                                                        <Dropdown.Item id="edit" icon={Edit01}>Edit user</Dropdown.Item>
                                                        <Dropdown.Item id="reset" icon={Key01}>{resettingUserId === u.id ? 'Resetting…' : 'Reset password'}</Dropdown.Item>
                                                        <Dropdown.Separator />
                                                        <Dropdown.Item id="toggle" icon={u.isActive ? UserX01 : UserCheck01}>
                                                            {togglingUserId === u.id ? 'Updating…' : (u.isActive ? 'Deactivate' : 'Activate')}
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
                    <div className="pagination-bar">
                        <div className="pagination-info">
                            Showing <strong>{startItem}-{endItem}</strong> of <strong>{sorted.length}</strong>
                        </div>
                        <div className="pagination-controls">
                            <button className="pagination-btn" disabled={page === 0} onClick={() => setPage(0)} title="First page">{'<<'}</button>
                            <button className="pagination-btn" disabled={page === 0} onClick={() => setPage(page - 1)} title="Previous page">{'<'}</button>
                            <span className="pagination-pages">
                                Page <strong>{page + 1}</strong> of <strong>{totalPages}</strong>
                            </span>
                            <button className="pagination-btn" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)} title="Next page">{'>'}</button>
                            <button className="pagination-btn" disabled={page >= totalPages - 1} onClick={() => setPage(totalPages - 1)} title="Last page">{'>>'}</button>
                        </div>
                        <div className="pagination-size">
                            <label>Rows:</label>
                            <select value={rowsPerPage} onChange={(e) => { setRowsPerPage(Number(e.target.value)); setPage(0); }}>
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
                saving={!!resettingUserId}
                result={resetResult}
            />
        </div>
    );
}
export default function App() {
    const [projects, setProjects] = useState([]);
    const [loading, setLoading] = useState(true);
    const [syncOpen, setSyncOpen] = useState(false);
    const [configOpen, setConfigOpen] = useState(false);
    const [scheduleOpen, setScheduleOpen] = useState(false);
    const [regions, setRegions] = useState({});
    const [continents, setContinents] = useState([]);
    const [newProjectIds, setNewProjectIds] = useState(new Set());
    const preSyncIdsRef = useRef(new Set());

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

    const [authUser, setAuthUser] = useState(null);
    const [authError, setAuthError] = useState('');
    const [mustChangeError, setMustChangeError] = useState('');
    const [bootstrapStatus, setBootstrapStatus] = useState(null);

    const [route, setRoute] = useState(normalizeRoute(window.location.hash.replace('#', '')));
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const [mobileNavOpen, setMobileNavOpen] = useState(false);
    const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'dark');

    const [commentsOpen, setCommentsOpen] = useState(false);
    const [selectedProject, setSelectedProject] = useState(null);
    const [selectedProjectIndex, setSelectedProjectIndex] = useState(null);
    const [commentsMine, setCommentsMine] = useState(false);
    const [commentsBody, setCommentsBody] = useState('');
    const [comments, setComments] = useState([]);

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
        document.documentElement.setAttribute('data-theme', theme);
        document.documentElement.classList.toggle('dark-mode', theme === 'dark');
        localStorage.setItem('theme', theme);
    }, [theme]);

    const loadProjects = useCallback(async () => {
        const res = await apiFetch(`${API}/projects`);
        setProjects(await res.json());
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
            return true;
        });
    }, [projects, chips, freeText, source, verified, region, continent, regions, decision, endDateFrom, endDateTo, scrapedFrom, scrapedTo, getRegion]);

    const sources = useMemo(() => [...new Set(projects.map((p) => p.source).filter(Boolean))].sort(), [projects]);

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
    };

    const handleDecisionChange = async (index, nextDecision) => {
        setProjects((prev) => {
            const next = [...prev];
            next[index] = { ...next[index], decision: nextDecision };
            return next;
        });
        if (selectedProjectIndex === index) {
            setSelectedProject((prev) => (prev ? { ...prev, decision: nextDecision } : prev));
        }
        await apiFetch(`${API}/projects/${index}/decision`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ decision: nextDecision }),
        });
    };


    const handleDeadlineChange = async (index, manualDeadline) => {
        const res = await apiFetch(`${API}/projects/${index}/deadline`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ manualDeadline }),
        });
        if (!res.ok) throw new Error('Failed to update deadline');
        const updated = await res.json();
        setProjects((prev) => {
            const next = [...prev];
            next[index] = updated;
            return next;
        });
        if (selectedProjectIndex === index) {
            setSelectedProject(updated);
        }
    };

    const handleDelete = async (index) => {
        const res = await apiFetch(`${API}/projects/${index}`, { method: 'DELETE' });
        if (res.ok) {
            setProjects((prev) => prev.filter((_, i) => i !== index));
            if (selectedProjectIndex === index) {
                setSelectedProject(null);
                setSelectedProjectIndex(null);
                setCommentsOpen(false);
            }
        }
    };

    const snapshotBeforeSync = useCallback(() => {
        preSyncIdsRef.current = new Set(projects.map((p) => `${p.project_id}__${p.project_name}`));
    }, [projects]);

    const handleSyncDone = useCallback(async () => {
        const prevIds = preSyncIdsRef.current;
        const res = await apiFetch(`${API}/projects`);
        const data = await res.json();
        setProjects(data);
        const newIds = new Set();
        data.forEach((p) => {
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
                <TopBar
                    onOpenMobile={() => setMobileNavOpen(true)}
                    theme={theme}
                    onToggleTheme={() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))}
                    user={authUser}
                />
                <div className="layout-page-scroll">
                    <div className="layout-shell-container layout-page-container">
                        {route === 'dashboard' ? (
                            <div className="layout-dashboard layout-content-row">
                                <div className="layout-dashboard-main">
                                    <PageHeader
                                        title="Procurement Watch"
                                        subtitle="Track tenders, review sources, and manage decisions."
                                        action={(
                                            <div className="header-actions">
                                                <div className="header-buttons">
                                                    <button type="button" className="header-secondary-btn" onClick={() => setConfigOpen(true)}>
                                                        Settings / Parameters
                                                    </button>
                                                    <button type="button" className="sync-btn" onClick={() => setSyncOpen(true)}>
                                                        Sync
                                                    </button>
                                                    <button type="button" className="header-secondary-btn" onClick={() => setScheduleOpen(true)}>
                                                        Schedule
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

