import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { FlaskConical, Inbox, LayoutDashboard, RotateCcw, ScanLine, Shield, User, UserPlus } from 'lucide-react';
import { useApi, useDemo } from '../app/context';
import { useMe } from '../api/hooks';
import { Sheet } from '../components/ui/Sheet';
import { IconTile, Row, Section } from '../components/ui/List';
import { useConfirm, useToast } from '../components/ui/Overlays';
import { cn } from '../lib/cn';
import { errorMessage } from '../api/client';
import { copyText } from '../lib/share';

const SCANNER_CODE = '4242-4242-4242';

export function DemoButton({ wide, className }: { wide?: boolean; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'press inline-flex items-center justify-center gap-2 rounded-full font-semibold',
          wide ? 'h-10 w-full bg-orange-soft text-subhead text-orange' : 'glass h-9 px-3.5 text-footnote text-orange',
          className,
        )}
        aria-label="Åpne demo-panelet"
      >
        <FlaskConical className="h-4 w-4" /> Demo
      </button>
      <DemoPanel open={open} onClose={() => setOpen(false)} />
    </>
  );
}

export function DemoPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const api = useApi();
  const demo = useDemo();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const toast = useToast();
  const me = useMe().data?.me ?? null;
  const [busy, setBusy] = useState<string | null>(null);

  const loginAs = async (persona: 'buyer' | 'organizer' | 'admin' | 'new', target: string) => {
    setBusy(persona);
    try {
      await api.post('/auth/logout');
      await api.post('/auth/demo', { provider: 'vipps', persona, ...(persona === 'new' ? { name: 'Ny Bruker' } : {}) });
      await qc.invalidateQueries();
      const fresh = await qc.fetchQuery({ queryKey: ['me'], queryFn: () => api.get<{ me: { organizations: { id: string }[] } | null }>('/me') });
      onClose();
      if (persona === 'organizer' && fresh.me?.organizations[0]) navigate(`/arrangor/${fresh.me.organizations[0].id}`);
      else navigate(target);
      toast({ message: 'Byttet rolle', tone: 'success' });
    } catch (err) {
      toast({ message: errorMessage(err), tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Demo-modus">
      <p className="mb-5 px-1 text-subhead text-label-2">
        Dette er ekte TIKIT-kode som kjører i nettleseren din. Innlogging med Vipps, Apple og Google og betaling er simulert – ingen penger trekkes, og alt er
        oppdiktet.
      </p>
      <Section header="Prøv appen som">
        <Row
          icon={
            <IconTile color="#3B4CF2">
              <User />
            </IconTile>
          }
          title="Kjøper – Emma"
          subtitle="Har billetter, venteliste og favoritter"
          value={me?.name === 'Emma Hansen' ? 'Aktiv' : undefined}
          onClick={() => loginAs('buyer', '/billetter')}
          disabled={!!busy}
        />
        <Row
          icon={
            <IconTile color="#FF5E3A">
              <LayoutDashboard />
            </IconTile>
          }
          title="Arrangør – Jonas"
          subtitle="Nordlys Events og Russerevyen"
          value={me?.name === 'Jonas Berg' ? 'Aktiv' : undefined}
          onClick={() => loginAs('organizer', '/arrangor')}
          disabled={!!busy}
        />
        <Row
          icon={
            <IconTile color="#1C1C1E">
              <Shield />
            </IconTile>
          }
          title="Plattformadmin – Mari"
          subtitle="Godkjenn arrangører, gebyrer og oversikt"
          value={me?.name === 'Mari Admin' ? 'Aktiv' : undefined}
          onClick={() => loginAs('admin', '/admin')}
          disabled={!!busy}
        />
        <Row
          icon={
            <IconTile color="#12B886">
              <UserPlus />
            </IconTile>
          }
          title="Ny bruker"
          subtitle="Start helt fra scratch"
          onClick={() => loginAs('new', '/')}
          disabled={!!busy}
        />
      </Section>
      <Section header="Dørvakt" footer="Logg inn på skanneren med koden – ingen konto trengs. Koden gjelder Russetreff Vest.">
        <Row
          icon={
            <IconTile color="#30B0C7">
              <ScanLine />
            </IconTile>
          }
          title="Åpne billettskanneren"
          subtitle={`Skannerkode ${SCANNER_CODE}`}
          onClick={async () => {
            await copyText(SCANNER_CODE.replace(/-/g, ''));
            onClose();
            navigate('/skann');
            toast({ message: 'Skannerkoden er kopiert', tone: 'info' });
          }}
        />
      </Section>
      <Section>
        <Row
          icon={
            <IconTile color="#8E8E93">
              <Inbox />
            </IconTile>
          }
          title="Innboks (e-poster fra TIKIT)"
          onClick={() => {
            onClose();
            navigate('/demo/innboks');
          }}
          disabled={!me}
        />
        {demo && (
          <Row
            icon={
              <IconTile color="#FF3B30">
                <RotateCcw />
              </IconTile>
            }
            title="Tilbakestill demoen"
            destructive
            onClick={async () => {
              const ok = await confirm({ title: 'Tilbakestille demoen?', message: 'Alt du har gjort i demoen slettes, og eksempeldataene lages på nytt.', confirmLabel: 'Tilbakestill', destructive: true });
              if (!ok) return;
              setBusy('reset');
              await demo.reset();
              await qc.resetQueries();
              setBusy(null);
              onClose();
              navigate('/');
              toast({ message: 'Demoen er tilbakestilt', tone: 'success' });
            }}
          />
        )}
      </Section>
    </Sheet>
  );
}
