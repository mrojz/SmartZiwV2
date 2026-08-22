import { ArrowLeft } from 'lucide-react';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { usePageHeader } from '@/components/PageHeaderContext';
import SettingsForm from '@/components/SettingsForm';

export default function SettingsPage({ apiFetch, onBack }) {
    const { setPageHeader, clearPageHeader } = usePageHeader();

    useEffect(() => {
        setPageHeader({
            title: 'Settings',
            subtitle: 'Manage keywords and regions used for opportunity matching.',
            action: (
                <Button type="button" variant="outline" onClick={onBack}>
                    <ArrowLeft className="mr-2 size-4" />
                    Back
                </Button>
            ),
        });
        return () => clearPageHeader();
    }, [setPageHeader, clearPageHeader, onBack]);

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <SettingsForm apiFetch={apiFetch} />
            </Card>
        </div>
    );
}
