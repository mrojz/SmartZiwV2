import { FileText, MessageSquare, Sparkles, LayoutList } from 'lucide-react';

const TABS = [
    { id: 'overview', label: 'Overview', icon: LayoutList },
    { id: 'documents', label: 'Documents', icon: FileText },
    { id: 'activity', label: 'Activity', icon: MessageSquare },
    { id: 'smart-ziw', label: 'Smart-Ziw', icon: Sparkles },
];

export default function TenderTabs({ activeTab, onChange, compact = false }) {
    return (
        <div className={`flex border-b ${compact ? 'gap-1' : 'gap-2'}`} role="tablist" aria-label="Tender sections">
            {TABS.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                    <button
                        key={tab.id}
                        id={`tab-${tab.id}`}
                        role="tab"
                        aria-selected={isActive}
                        aria-label={tab.label}
                        onClick={() => onChange(tab.id)}
                        className={`flex items-center gap-1.5 border-b-2 px-3 text-sm font-medium transition-colors ${
                            compact ? 'py-2' : 'py-3'
                        } ${
                            isActive
                                ? 'border-primary text-primary'
                                : 'border-transparent text-muted-foreground hover:text-foreground'
                        }`}
                    >
                        <Icon className={`${compact ? 'h-3.5 w-3.5' : 'h-4 w-4'}`} />
                        <span className={compact ? 'hidden sm:inline' : ''}>{tab.label}</span>
                    </button>
                );
            })}
        </div>
    );
}
