import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import PageHeader from '@/components/PageHeader';
import SettingsForm from '@/components/SettingsForm';

export default function SettingsPage({ apiFetch, onBack }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col p-6">
      <div className="w-full">
        <PageHeader
          title={
            <span className="flex items-center gap-3">
              <Button type="button" variant="ghost" size="icon" onClick={onBack}>
                <ArrowLeft className="size-5" />
              </Button>
              <span>Settings</span>
            </span>
          }
          subtitle="Manage keywords and regions used for opportunity matching."
        />
        <Card className="flex min-h-0 flex-col overflow-hidden">
          <SettingsForm apiFetch={apiFetch} />
        </Card>
      </div>
    </div>
  );
}
