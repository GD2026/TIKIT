import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { BadgeCheck } from 'lucide-react';
import type { Me, ProviderId } from '../../shared/types';
import { useApi } from '../app/context';
import { useAuth } from '../app/auth';
import { qk, useConfig, type MeResponse } from '../api/hooks';
import { errorMessage } from '../api/client';
import { Page } from '../components/layout/Page';
import { Section } from '../components/ui/List';
import { Button } from '../components/ui/Button';
import { RequireLogin } from '../components/ui/States';
import { useConfirm, useToast } from '../components/ui/Overlays';
import { GoogleGlyph } from '../components/brand/Brand';

const INFO: Record<ProviderId, { name: string; detail: string }> = {
  vipps: { name: 'Vipps', detail: 'Rask innlogging og bekreftet alder' },
  apple: { name: 'Apple', detail: 'Du kan skjule e-postadressen din' },
  google: { name: 'Google', detail: 'Logg inn med Google-kontoen din' },
};

function ProviderIcon({ id }: { id: ProviderId }) {
  if (id === 'vipps')
    return (
      <span data-brand-mark className="flex h-[30px] w-[30px] items-center justify-center rounded-[8px] bg-[var(--vipps)] text-[0.55rem] font-extrabold text-white" aria-hidden="true">
        vipps
      </span>
    );
  if (id === 'apple')
    return (
      <span className="flex h-[30px] w-[30px] items-center justify-center rounded-[8px] bg-label text-bg" aria-hidden="true">
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
          <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701" />
        </svg>
      </span>
    );
  return (
    <span className="flex h-[30px] w-[30px] items-center justify-center rounded-[8px] bg-white shadow-[inset_0_0_0_1px_var(--separator)]" aria-hidden="true">
      <GoogleGlyph className="h-4 w-4" />
    </span>
  );
}

function Methods({ me }: { me: Me }) {
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const { startProvider } = useAuth();
  const config = useConfig().data;
  const [busy, setBusy] = useState<ProviderId | null>(null);
  const available = (config?.providers ?? []).map((p) => p.id);
  const all: ProviderId[] = ['vipps', 'apple', 'google'];

  const unlink = async (p: ProviderId) => {
    const ok = await confirm({ title: `Koble fra ${INFO[p].name}?`, message: 'Du kan ikke lenger logge inn med denne. Du kan koble den til igjen senere.', confirmLabel: 'Koble fra', destructive: true });
    if (!ok) return;
    setBusy(p);
    try {
      const res = await api.del<{ me: Me }>(`/me/identities/${p}`);
      qc.setQueryData<MeResponse>(qk.me, (prev) => ({ scanner: prev?.scanner ?? null, me: res.me }));
      toast({ message: `${INFO[p].name} er koblet fra`, tone: 'success' });
    } catch (err) {
      toast({ message: errorMessage(err), tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mx-4">
      <Section footer="Du kan koble flere innloggingsmetoder til samme konto. Billettene følger kontoen, ikke telefonen.">
        {all.map((p) => {
          const linked = me.providers.includes(p);
          const canLink = available.includes(p);
          return (
            <div key={p} className="flex min-h-14 items-center gap-3 px-4 py-2.5">
              <ProviderIcon id={p} />
              <div className="min-w-0 flex-1">
                <p className="text-body">{INFO[p].name}</p>
                <p className="text-footnote text-label-2">{linked ? 'Koblet til' : INFO[p].detail}</p>
              </div>
              {linked ? (
                <Button size="sm" variant="gray" loading={busy === p} disabled={me.providers.length <= 1} onClick={() => void unlink(p)} aria-label={`Koble fra ${INFO[p].name}`}>
                  Koble fra
                </Button>
              ) : (
                <Button size="sm" variant="tinted" disabled={!canLink} onClick={() => startProvider(p, { mode: 'link', returnTo: '/profil/innlogging' })} aria-label={`Koble til ${INFO[p].name}`}>
                  Koble til
                </Button>
              )}
            </div>
          );
        })}
      </Section>
      <Section header="Alder">
        <div className="flex items-start gap-3 px-4 py-3">
          <BadgeCheck className={me.birthdateVerified ? 'mt-0.5 h-5 w-5 text-green' : 'mt-0.5 h-5 w-5 text-label-3'} aria-hidden="true" />
          <p className="text-subhead">
            {me.birthdateVerified
              ? 'Alderen din er bekreftet med Vipps. Du kan kjøpe billetter til arrangementer med aldersgrense uten ekstra kontroll i appen.'
              : 'Alderen din er ikke bekreftet. Koble til Vipps for å bekrefte den automatisk – noen arrangører krever det.'}
          </p>
        </div>
      </Section>
    </div>
  );
}

export default function LoginMethods() {
  const { me } = useAuth();
  return (
    <Page title="Innloggingsmetoder" back="/profil">
      <RequireLogin>{me && <Methods me={me} />}</RequireLogin>
    </Page>
  );
}
