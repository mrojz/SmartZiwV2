import {
    House,
    Briefcase,
    ChartColumn,
    Shield,
    Settings as SettingsIcon,
    User as UserIcon,
    CalendarClock,
    LogOut,
    ChevronDown,
    Search,
} from 'lucide-react';
import {
    Sidebar as SidebarBase,
    SidebarContent,
    SidebarFooter,
    SidebarGroup,
    SidebarGroupContent,
    SidebarGroupLabel,
    SidebarHeader,
    SidebarInput,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarRail,
    SidebarTrigger,
} from '@/components/ui/sidebar';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Avatar as AvatarBase, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

export const NAV_GROUPS = [
    {
        label: 'Main',
        items: [
            { key: 'dashboard', label: 'Dashboard', icon: House },
            { key: 'tenders', label: 'Tenders', icon: Briefcase },
        ],
    },
    {
        label: 'Intelligence',
        items: [
            { key: 'analytics', label: 'Analytics', icon: ChartColumn },
        ],
    },
    {
        label: 'Management',
        adminOnly: true,
        items: [
            { key: 'admin', label: 'Admin', icon: Shield },
            { key: 'schedule', label: 'Schedule', icon: CalendarClock },
            { key: 'settings', label: 'Settings', icon: SettingsIcon },
        ],
    },
    {
        label: 'Settings',
        items: [
            { key: 'profile', label: 'Profile', icon: UserIcon },
        ],
    },
];

function initials(name = '', email = '') {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    if (parts.length === 1) return parts[0][0].toUpperCase();
    return (email[0] || '?').toUpperCase();
}

export function Avatar({ user, size = 34 }) {
    return (
        <AvatarBase style={{ width: size, height: size }}>
            {user?.avatarUrl ? <AvatarImage src={user.avatarUrl} alt={user.name || 'user'} /> : null}
            <AvatarFallback>{initials(user?.name || '', user?.email || '')}</AvatarFallback>
        </AvatarBase>
    );
}

export default function Sidebar({ user, route, onNavigate, collapsed, mobileOpen, onToggleCollapse, onCloseMobile, onOpenCommand }) {
    const groups = NAV_GROUPS.filter((group) => !group.adminOnly || user?.role === 'admin');

    return (
        <SidebarBase collapsible="icon">
            <SidebarHeader>
                <div className="flex items-center justify-between gap-2 px-2">
                    <div className="flex min-w-0 items-center gap-2">
                        <img
                            className="h-7 w-auto group-data-[collapsible=icon]:hidden"
                            src="/forvis-mazars-logo.svg"
                            alt="Forvis Mazars"
                        />
                        <span className="truncate text-sm font-semibold text-sidebar-foreground group-data-[collapsible=icon]:hidden">
                            Procurement Watch
                        </span>
                    </div>
                    <SidebarTrigger />
                </div>
                <div className="relative group-data-[collapsible=icon]:hidden">
                    <SidebarInput
                        placeholder="Search…"
                        readOnly
                        onClick={() => onOpenCommand?.()}
                        onFocus={() => onOpenCommand?.()}
                        className="cursor-pointer pr-12 pl-8"
                    />
                    <Search className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <kbd className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 rounded border border-sidebar-border bg-sidebar-accent px-1.5 py-0.5 text-[10px] font-medium text-sidebar-foreground/70">
                        ⌘K
                    </kbd>
                </div>
            </SidebarHeader>
            <SidebarContent>
                {groups.map((group) => (
                    <SidebarGroup key={group.label}>
                        <Collapsible defaultOpen className="group/collapsible">
                            <SidebarGroupLabel asChild>
                                <CollapsibleTrigger className="gap-2">
                                    {group.label}
                                    <ChevronDown className="ml-auto transition-transform group-data-[state=open]/collapsible:rotate-180" />
                                </CollapsibleTrigger>
                            </SidebarGroupLabel>
                            <CollapsibleContent>
                                <SidebarGroupContent>
                                    <SidebarMenu>
                                        {group.items.map((item) => (
                                            <SidebarMenuItem key={item.key}>
                                                <SidebarMenuButton
                                                    isActive={route === item.key}
                                                    tooltip={item.label}
                                                    onClick={() => {
                                                        onNavigate(item.key);
                                                        onCloseMobile();
                                                    }}
                                                >
                                                    <item.icon />
                                                    <span>{item.label}</span>
                                                </SidebarMenuButton>
                                            </SidebarMenuItem>
                                        ))}
                                    </SidebarMenu>
                                </SidebarGroupContent>
                            </CollapsibleContent>
                        </Collapsible>
                    </SidebarGroup>
                ))}
            </SidebarContent>
            <SidebarFooter>
                <div className="flex items-center gap-2 px-2 py-1">
                    <Avatar user={user} size={34} />
                    <div className="min-w-0 flex-1 leading-tight group-data-[collapsible=icon]:hidden">
                        <p className="truncate text-sm font-medium text-sidebar-foreground">{user?.name}</p>
                        <p className="truncate text-xs text-sidebar-foreground/60">{user?.role}</p>
                    </div>
                    <SidebarMenuButton
                        tooltip="Logout"
                        onClick={() => {
                            onNavigate('logout');
                            onCloseMobile();
                        }}
                        className="h-8 w-8 shrink-0 justify-center p-0"
                    >
                        <LogOut />
                    </SidebarMenuButton>
                </div>
            </SidebarFooter>
            <SidebarRail />
        </SidebarBase>
    );
}
