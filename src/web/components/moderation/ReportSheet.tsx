import { useState } from 'react';
import { Check, Flag } from 'lucide-react';
import type { ReportReason } from '../../../shared/types';
import { useApi } from '../../app/context';
import { errorMessage } from '../../api/client';
import { Sheet } from '../ui/Sheet';
import { Button } from '../ui/Button';
import { TextArea } from '../ui/Field';
import { useToast } from '../ui/Overlays';
import { cn } from '../../lib/cn';

/**
 * «Rapporter» for an event or an organizer (App Store Review Guideline 1.2). Works without signing in;
 * the report goes to the platform admins' queue (/admin/rapporter) and to SUPPORT_EMAIL.
 */

const REASONS: { id: ReportReason; label: string; detail: string }[] = [
  { id: 'offensive', label: 'Støtende eller hatefullt', detail: 'Trakassering, diskriminering, vold eller seksuelt innhold' },
  { id: 'fraud', label: 'Svindel', detail: 'Falske billetter, arrangementet finnes ikke' },
  { id: 'illegal', label: 'Ulovlig', detail: 'For eksempel salg av alkohol til mindreårige' },
  { id: 'misleading', label: 'Villedende', detail: 'Feil dato, sted, pris eller aldersgrense' },
  { id: 'other', label: 'Annet', detail: 'Beskriv det under' },
];

export function ReportSheet({
  open,
  onClose,
  kind,
  targetId,
  targetName,
}: {
  open: boolean;
  onClose: () => void;
  kind: 'event' | 'organizer';
  targetId: string;
  targetName: string;
}) {
  const api = useApi();
  const toast = useToast();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const close = () => {
    onClose();
    setReason(null);
    setMessage('');
  };

  const send = async () => {
    if (!reason) return;
    setBusy(true);
    try {
      await api.post('/reports', { kind, targetId, reason, message: message.trim() });
      toast({ message: 'Takk! Vi ser på rapporten så raskt vi kan.', tone: 'success' });
      close();
    } catch (err) {
      toast({ message: errorMessage(err), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={close} locked={busy} title={kind === 'event' ? 'Rapporter arrangement' : 'Rapporter arrangør'}>
      <p className="mb-4 px-1 text-subhead text-label-2">
        Hva er galt med <span className="font-semibold text-label">{targetName}</span>? Rapporten går til TIKIT, ikke til arrangøren.
      </p>
      <div className="flex flex-col gap-2" role="radiogroup" aria-label="Grunn">
        {REASONS.map((r) => (
          <button
            key={r.id}
            type="button"
            role="radio"
            aria-checked={reason === r.id}
            onClick={() => setReason(r.id)}
            className={cn('flex items-center gap-3 rounded-[14px] p-3 text-left transition-colors', reason === r.id ? 'bg-tint-soft shadow-[inset_0_0_0_2px_var(--tint)]' : 'bg-fill-4')}
          >
            <span className="min-w-0 flex-1">
              <span className="block text-subhead font-semibold">{r.label}</span>
              <span className="block text-footnote text-label-2">{r.detail}</span>
            </span>
            {reason === r.id && <Check className="h-5 w-5 shrink-0 text-tint" aria-hidden="true" />}
          </button>
        ))}
      </div>
      <TextArea className="mt-4" label="Beskrivelse (valgfritt)" rows={3} maxLength={1000} value={message} onChange={(e) => setMessage(e.target.value)} />
      <Button full size="lg" className="mt-5" disabled={!reason} loading={busy} onClick={() => void send()} icon={<Flag className="h-4 w-4" />}>
        Send rapport
      </Button>
    </Sheet>
  );
}
