import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Copy, Share } from 'lucide-react';
import type { ResaleListing, TicketDTO } from '../../../shared/types';
import { formatNok, oreToInput, parseKroner } from '../../../shared/money';
import { useApi } from '../../app/context';
import { qk } from '../../api/hooks';
import { errorMessage } from '../../api/client';
import { Sheet } from '../ui/Sheet';
import { TextArea, TextField } from '../ui/Field';
import { Button } from '../ui/Button';
import { useToast } from '../ui/Overlays';
import { copyText, shareLink } from '../../lib/share';

export function TransferSheet({ ticket, open, onClose }: { ticket: TicketDTO; open: boolean; onClose: () => void }) {
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const [contact, setContact] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ link: string; recipientName: string | null } | null>(null);

  const close = () => {
    onClose();
    window.setTimeout(() => {
      setResult(null);
      setContact('');
      setMessage('');
    }, 300);
  };

  const submit = async () => {
    setBusy(true);
    try {
      const res = await api.post<{ transferId: string; link: string; recipientName: string | null }>(`/tickets/${ticket.id}/transfer`, {
        contact: contact.trim() || null,
        message: message.trim() || null,
      });
      setResult({ link: res.link, recipientName: res.recipientName });
      await Promise.all([qc.invalidateQueries({ queryKey: qk.tickets }), qc.invalidateQueries({ queryKey: qk.ticket(ticket.id) })]);
    } catch (err) {
      toast({ message: errorMessage(err), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={close} locked={busy} title={result ? 'Klar til å sende' : 'Overfør billetten'}>
      {!result ? (
        <form
          className="flex flex-col gap-4 pb-2"
          onSubmit={(ev) => {
            ev.preventDefault();
            void submit();
          }}
        >
          <p className="text-subhead text-label-2">
            Du får en lenke du sender til mottakeren. Når de godtar, flyttes billetten til dem og får en ny QR-kode – din kode slutter å virke. Frem til da kan du angre.
          </p>
          <TextField
            label="Mottaker (valgfritt)"
            hint="E-post eller mobilnummer. Har personen TIKIT, får de også et varsel i appen."
            value={contact}
            onChange={(ev) => setContact(ev.target.value)}
            autoComplete="off"
            inputMode="email"
            maxLength={254}
          />
          <TextArea label="Melding (valgfritt)" value={message} onChange={(ev) => setMessage(ev.target.value)} rows={2} maxLength={200} placeholder="Kos deg!" />
          <Button type="submit" size="lg" full loading={busy}>
            Lag overføringslenke
          </Button>
        </form>
      ) : (
        <div className="flex flex-col gap-4 pb-2">
          <p className="text-body">
            {result.recipientName ? `${result.recipientName} har fått et varsel i TIKIT. ` : ''}Send lenken til mottakeren. Den gjelder i 14 dager og kan bare brukes én gang.
          </p>
          <div className="break-all rounded-[12px] bg-fill-3 px-3.5 py-3 font-mono text-footnote">{result.link}</div>
          <p className="text-footnote text-label-2">Lenken vises bare nå. Mister du den, kan du avbryte overføringen og lage en ny.</p>
          <div className="grid grid-cols-2 gap-3">
            <Button
              variant="gray"
              icon={<Copy className="h-4 w-4" />}
              onClick={async () => {
                const ok = await copyText(result.link);
                toast({ message: ok ? 'Lenken er kopiert' : 'Kunne ikke kopiere – merk og kopier lenken', tone: ok ? 'success' : 'error' });
              }}
            >
              Kopier
            </Button>
            <Button
              icon={<Share className="h-4 w-4" />}
              onClick={async () => {
                const r = await shareLink({ title: `Billett til ${ticket.event.title}`, text: 'Her er billetten din – trykk for å legge den i TIKIT:', url: result.link });
                if (r === 'copied') toast({ message: 'Lenken er kopiert', tone: 'success' });
              }}
            >
              Del
            </Button>
          </div>
          <Button variant="plain" onClick={close}>
            Ferdig
          </Button>
        </div>
      )}
    </Sheet>
  );
}

export function ResaleSheet({ ticket, open, onClose }: { ticket: TicketDTO; open: boolean; onClose: () => void }) {
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const [price, setPrice] = useState(() => oreToInput(ticket.resaleMaxOre));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ore = parseKroner(price);

  const submit = async () => {
    if (ore === null || ore < 100) {
      setError('Skriv en pris på minst 1 kr.');
      return;
    }
    if (ore > ticket.resaleMaxOre) {
      setError(`Maks ${formatNok(ticket.resaleMaxOre)} – du kan ikke selge dyrere enn du kjøpte.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const listing = await api.post<ResaleListing>(`/tickets/${ticket.id}/resale`, { priceOre: ore });
      await Promise.all([qc.invalidateQueries({ queryKey: qk.tickets }), qc.invalidateQueries({ queryKey: qk.ticket(ticket.id) })]);
      toast({ message: `Lagt ut for ${formatNok(listing.priceOre)}`, tone: 'success' });
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} locked={busy} title="Selg videre">
      <form
        className="flex flex-col gap-4 pb-2"
        onSubmit={(ev) => {
          ev.preventDefault();
          void submit();
        }}
      >
        <p className="text-subhead text-label-2">
          Billetten legges ut i TIKIT for andre som vil kjøpe. Når den er solgt, får du pengene tilbake på betalingsmåten du brukte, og kjøperen får en ny QR-kode. Til da kan du trekke den tilbake.
        </p>
        <TextField
          label="Pris i kroner"
          hint={`Maks ${formatNok(ticket.resaleMaxOre)} – det du betalte. Norsk lov forbyr videresalg med påslag.`}
          value={price}
          onChange={(ev) => setPrice(ev.target.value)}
          inputMode="decimal"
          error={error}
          trailing={<span className="pr-2 text-body text-label-2">kr</span>}
        />
        <Button type="submit" size="lg" full loading={busy}>
          Legg ut for {ore !== null && ore >= 100 ? formatNok(ore) : '…'}
        </Button>
      </form>
    </Sheet>
  );
}
