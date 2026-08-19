import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import PageHeader from '@/components/PageHeader';
import ScheduleForm from '@/components/ScheduleForm';

export default function SchedulePage({ apiFetch, onBack }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col p-6">
      <div className="w-full">
        <PageHeader
          title={
            <span className="flex items-center gap-3">
              <Button type="button" variant="ghost" size="icon" onClick={onBack}>
                <ArrowLeft className="size-5" />
              </Button>
              <span>Sync Schedule</span>
            </span>
          }
          subtitle="Configure automated sync cadence, sources, and processing options."
        />
        <Card className="flex min-h-0 flex-col overflow-hidden">
          <ScheduleForm apiFetch={apiFetch} onBack={onBack} />
        </Card>
      </div>
    </div>
  );
}
