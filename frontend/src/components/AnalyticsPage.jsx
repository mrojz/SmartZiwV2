import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export default function AnalyticsPage() {
    return (
        <div className="mx-auto w-full max-w-3xl px-4 py-8">
            <div className="mb-6">
                <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
                <p className="mt-1.5 text-sm text-muted-foreground">Analytics are coming soon.</p>
            </div>
            <Card>
                <CardContent className="flex flex-col items-start gap-4 p-6">
                    <Badge variant="secondary">Coming soon</Badge>
                    <Button type="button" disabled>Explore analytics</Button>
                </CardContent>
            </Card>
        </div>
    );
}
