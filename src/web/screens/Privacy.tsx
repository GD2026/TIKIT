import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Copy, Download, Trash2 } from 'lucide-react';
import { useApi } from '../app/context';
import { clearOfflineTicketCache } from '../app/auth';
import { errorMessage } from '../api/client';
import { Page } from '../components/layout/Page';
import { IconTile, Row, Section } from '../components/ui/List';
import { Sheet } from '../components/ui/Sheet';
import { Button } from '../components/ui/Button';
import { RequireLogin } from '../components/ui/States';
import { useConfirm, useToast } from '../components/ui/Overlays';
import { copyText } from '../lib/share';
import { canDownload } from '../lib/links';

function PrivacyBody() {
  const api = useApi();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState<'export' | 'delete' | null>(null);
  const [json, setJson] = useState<string | null>(null);

  const exportData = async () => {
    setBusy('export');
    try {
      const data = await api.get<unknown>('/me/export');
      const text = JSON.stringify(data, null, 2);
      // The first check is resolved at build time, so the single-file demo ships without a download path.
      if (import.meta.env.MODE !== 'demo' && canDownload) {
        const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = 'tikit-mine-data.json';
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 2000);
        toast({ message: 'Dataene er lastet ned', tone: 'success' });
      } else {
        setJson(text);
      }
    } catch (err) {
      toast({ message: errorMessage(err), tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const deleteAccount = async () => {
    const answer = await confirm({
      title: 'Slette kontoen?',
      message: 'Profilen, innloggingene, favorittene og varslene dine slettes. Bestillinger beholdes uten navn og kontaktinfo så lenge regnskapsreglene krever det. Skriv SLETT for å bekrefte.',
      confirmLabel: 'Slett kontoen',
      destructive: true,
      input: { label: 'Skriv SLETT', placeholder: 'SLETT', minLength: 5 },
    });
    if (typeof answer !== 'string') return;
    if (answer.trim().toUpperCase() !== 'SLETT') {
      toast({ message: 'Skriv SLETT for å bekrefte', tone: 'error' });
      return;
    }
    setBusy('delete');
    try {
      await api.del('/me');
      await clearOfflineTicketCache();
      qc.clear();
      navigate('/', { replace: true });
      toast({ message: 'Kontoen er slettet', tone: 'info' });
    } catch (err) {
      toast({ message: errorMessage(err), tone: 'error' });
      setBusy(null);
    }
  };

  return (
    <div className="mx-4">
      <Section header="Dine data" footer="Du får en fil med profilen, bestillingene, billettene og varslene dine.">
        <Row
          icon={
            <IconTile color="#3B4CF2">
              <Download />
            </IconTile>
          }
          title="Last ned dataene mine"
          onClick={() => void exportData()}
          disabled={busy === 'export'}
        />
      </Section>
      <Section header="Hva vi lagrer">
        <div className="space-y-3 px-4 py-3.5 text-subhead leading-relaxed">
          <p>Navn, e-post, mobilnummer og fødselsdato – for å levere billetter, sende kvitteringer og sjekke aldersgrenser.</p>
          <p>Bestillinger og billetter – for at billettene skal virke i døra, og fordi salgsdokumentasjon må oppbevares etter bokføringsreglene.</p>
          <p>Vi selger aldri data, og arrangøren får bare det som trengs for å gjennomføre arrangementet.</p>
        </div>
      </Section>
      <Section footer="Har du billetter til kommende arrangementer, må du overføre eller refundere dem først.">
        <Row
          icon={
            <IconTile color="#FF3B30">
              <Trash2 />
            </IconTile>
          }
          title="Slett kontoen"
          destructive
          chevron={false}
          onClick={() => void deleteAccount()}
          disabled={busy === 'delete'}
        />
      </Section>

      <Sheet open={!!json} onClose={() => setJson(null)} title="Dataene dine" size="large">
        <p className="mb-3 text-subhead text-label-2">Nedlasting er ikke tilgjengelig i demoen, så her er innholdet. Kopier det om du vil ta vare på det.</p>
        <Button
          variant="gray"
          size="sm"
          className="mb-3"
          icon={<Copy className="h-4 w-4" />}
          onClick={async () => {
            const ok = await copyText(json ?? '');
            toast({ message: ok ? 'Kopiert' : 'Kunne ikke kopiere', tone: ok ? 'success' : 'error' });
          }}
        >
          Kopier
        </Button>
        <pre className="max-h-[60vh] overflow-auto rounded-[12px] bg-fill-4 p-3 text-caption1 leading-snug">{json}</pre>
      </Sheet>
    </div>
  );
}

export default function Privacy() {
  return (
    <Page title="Personvern og data" back="/profil">
      <RequireLogin>
        <PrivacyBody />
      </RequireLogin>
    </Page>
  );
}
