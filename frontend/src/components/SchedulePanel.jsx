import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';
import ScheduleForm from '@/components/ScheduleForm';

export default function SchedulePanel({ open, onClose, apiFetch }) {
  return (
    <Sheet open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <SheetContent side="right" showCloseButton={false} className="flex w-full flex-col gap-0 p-0 sm:max-w-[680px]">
        <SheetHeader className="flex flex-row items-start justify-between gap-4 border-b p-6 pb-5">
          <div className="min-w-0">
            <SheetDescription className="text-xs font-medium uppercase tracking-wide">Automated sync</SheetDescription>
            <SheetTitle className="mt-1 text-lg leading-snug">Sync Schedule</SheetTitle>
            <p className="mt-1 text-sm text-muted-foreground">Configure the automated sync cadence, sources, and processing options.</p>
          </div>
          <SheetClose asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Close schedule dialog">
              <X />
            </Button>
          </SheetClose>
        </SheetHeader>

        {open && <ScheduleForm apiFetch={apiFetch} onBack={onClose} />}
      </SheetContent>
    </Sheet>
  );
}
