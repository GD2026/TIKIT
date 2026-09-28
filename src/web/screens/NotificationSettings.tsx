import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Me, NotificationPrefs } from '../../shared/types';
import { useApi } from '../app/context';
import { useAuth } from '../app/auth';
import { qk, type MeResponse } from '../api/hooks';
import { errorMessage } from '../api/client';
import { Page } from '../components/layout/Page';
import { Section, ToggleRow } from '../components/ui/List';
import { RequireLogin } from '../components/ui/States';
import { useToast } from '../components/ui/Overlays';

const ITEMS: { key: keyof NotificationPrefs; title: string; subtitle: string }[] = [
  { key: 'reminders', title: 'Påminnelser', subtitle: 'Dagen før arrangementet, med billetten klar' },
  { key: 'waitlist', title: 'Venteliste og billettslipp', subtitle: 'Når billetter blir ledige eller salget åpner' },
  { key: 'email', title: 'E-post', subtitle: 'Send også varsler på e-post' },
  { key: 'marketing', title: 'Tips og nyheter', subtitle: 'Arrangementer vi tror du liker. Maks én gang i uken.' },
];

function Prefs({ me }: { me: Me }) {
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const [prefs, setPrefs] = useState(me.prefs);

  const set = async (key: keyof NotificationPrefs, value: boolean) => {
    const prev = prefs;
    setPrefs({ ...prefs, [key]: value });
    try {
      const res = await api.patch<{ me: Me }>('/me', { prefs: { [key]: value } });
      qc.setQueryData<MeResponse>(qk.me, (p) => ({ scanner: p?.scanner ?? null, me: res.me }));
    } catch (err) {
      setPrefs(prev);
      toast({ message: errorMessage(err), tone: 'error' });
    }
  };

  return (
    <div className="mx-4">
      <Section footer="Kvitteringer, billetter og viktige endringer (for eksempel avlysning) sendes alltid.">
        {ITEMS.map((i) => (
          <ToggleRow key={i.key} id={`pref-${i.key}`} title={i.title} subtitle={i.subtitle} checked={prefs[i.key]} onChange={(v) => void set(i.key, v)} />
        ))}
      </Section>
    </div>
  );
}

export default function NotificationSettings() {
  const { me } = useAuth();
  return (
    <Page title="Varslingsinnstillinger" back="/profil">
      <RequireLogin>{me && <Prefs me={me} />}</RequireLogin>
    </Page>
  );
}
