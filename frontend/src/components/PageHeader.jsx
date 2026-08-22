export default function PageHeader({ title, subtitle, action, className = '' }) {
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
