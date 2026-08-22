import { cn } from '@/utils/cn';

export default function SectionCard({ title, description, children, className }) {
    return (
        <div className={cn('rounded-lg border bg-card p-6', className)}>
            {title ? <h2 className="text-base font-semibold text-foreground">{title}</h2> : null}
            {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
            {title || description ? <div className="mb-4" /> : null}
            {children}
        </div>
    );
}
