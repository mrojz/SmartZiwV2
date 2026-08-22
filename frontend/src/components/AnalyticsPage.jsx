import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import PageHeader from './PageHeader';

export default function AnalyticsPage() {
    return (
        <div className="mx-auto w-full max-w-3xl">
            <PageHeader
                title="Analytics"
                subtitle="Analytics are coming soon."
            />
            <Card>
                <CardContent className="flex flex-col items-start gap-4 p-6">
                    <Badge variant="secondary">Coming soon</Badge>
                    <Button type="button" disabled>Explore analytics</Button>
                </CardContent>
            </Card>
        </div>
    );
}
