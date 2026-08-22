import { cn } from '@/utils/cn';

export default function PageHeader({ title, subtitle, action, className = '' }) {
    return (
        <div className={cn('mb-6', className)}>
            <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="min-w-0">
                    <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
                </div>
                {action ? <div className="flex items-center gap-2">{action}</div> : null}
            </div>
            {subtitle ? <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p> : null}
        </div>
    );
}
