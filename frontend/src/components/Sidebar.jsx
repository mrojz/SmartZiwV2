import { useState } from 'react';
import {
    HomeLine,
    Briefcase01,
    BarChart01,
    Shield01,
    User01,
    Settings01,
    Clock,
    LogOut01,
    Menu02,
    ChevronDown,
} from '@untitledui/icons';

const NAV_GROUPS = [
    {
        label: 'Main',
        items: [
            { key: 'dashboard', label: 'Dashboard', icon: HomeLine },
            { key: 'tenders', label: 'Tenders', icon: Briefcase01 },
        ],
    },
    {
        label: 'Intelligence',
        items: [
            { key: 'analytics', label: 'Analytics', icon: BarChart01 },
        ],
    },
    {
        label: 'Management',
        adminOnly: true,
        items: [
            { key: 'admin', label: 'Admin', icon: Shield01 },
            { key: 'schedule', label: 'Schedule', icon: Clock },
            { key: 'settings', label: 'Settings', icon: Settings01 },
        ],
    },
    {
        label: 'Settings',
        items: [
            { key: 'profile', label: 'Profile', icon: User01 },
        ],
    },
];

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

export function Avatar({ user, size = 34 }) {
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

export default function Sidebar({ user, route, onNavigate, collapsed, mobileOpen, onToggleCollapse, onCloseMobile }) {
    const groups = NAV_GROUPS.filter((group) => !group.adminOnly || user?.role === 'admin');
    const [collapsedGroups, setCollapsedGroups] = useState(() => new Set());

    const toggleGroup = (label) => {
        setCollapsedGroups((prev) => {
            const next = new Set(prev);
            if (next.has(label)) next.delete(label);
            else next.add(label);
            return next;
        });
    };

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
                {groups.map((group) => {
                    const groupCollapsed = collapsedGroups.has(group.label);
                    return (
                        <div className={`layout-nav-group ${groupCollapsed ? 'collapsed' : ''}`} key={group.label}>
                            <button
                                type="button"
                                className="layout-nav-group-header"
                                aria-expanded={!groupCollapsed}
                                onClick={() => toggleGroup(group.label)}
                            >
                                <span className="layout-nav-group-label">{group.label}</span>
                                <ChevronDown className={`layout-nav-group-chevron ${groupCollapsed ? '' : 'open'}`} aria-hidden="true" />
                            </button>
                            <div className="layout-nav-group-items">
                                {group.items.map((item) => (
                                    <button
                                        key={item.key}
                                        className={`layout-nav-item ${route === item.key ? 'active' : ''}`}
                                        title={collapsed ? item.label : ''}
                                        onClick={() => {
                                            onNavigate(item.key);
                                            onCloseMobile();
                                        }}
                                    >
                                        <span className="layout-nav-icon" aria-hidden="true"><item.icon className="layout-nav-svg" /></span>
                                        <span className="layout-nav-label">{item.label}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    );
                })}
                <button
                    className="layout-nav-item"
                    title={collapsed ? 'Logout' : ''}
                    onClick={() => {
                        onNavigate('logout');
                        onCloseMobile();
                    }}
                >
                    <span className="layout-nav-icon" aria-hidden="true"><LogOut01 className="layout-nav-svg" /></span>
                    <span className="layout-nav-label">Logout</span>
                </button>
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
