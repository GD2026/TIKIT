import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Mail, UserPlus } from 'lucide-react';
import type { OrgRole } from '../../shared/types';
import type { TeamMember } from '../../server/services/organizers';
import { useApi } from '../app/context';
import { useAuth } from '../app/auth';
import { ApiError, errorMessage } from '../api/client';
import { Page } from '../components/layout/Page';
import { SelectField, TextField } from '../components/ui/Field';
import { Button } from '../components/ui/Button';
import { Avatar } from '../components/ui/Avatar';
import { Pill } from '../components/ui/Feedback';
import { Sheet } from '../components/ui/Sheet';
import { CenterSpinner, QueryError } from '../components/ui/States';
import { useConfirm, useToast } from '../components/ui/Overlays';
import { canManage, orgKey, useOrg, useOrgQuery } from './shared';

const ROLES: { id: OrgRole; label: string; detail: string }[] = [
  { id: 'owner', label: 'Eier', detail: 'Alt, inkludert team og utbetalinger' },
  { id: 'admin', label: 'Administrator', detail: 'Arrangementer, billetter, ordre, refusjon og oppgjør' },
  { id: 'staff', label: 'Dørvakt/ansatt', detail: 'Skanne billetter og se deltakerlister uten kontaktinfo' },
];
const roleLabel = (r: OrgRole) => ROLES.find((x) => x.id === r)?.label ?? r;

interface TeamData {
  members: TeamMember[];
  invites: { id: string; email: string; role: OrgRole; createdAt: string }[];
}

export default function Team() {
  const { org } = useOrg();
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const { me } = useAuth();
  const q = useOrgQuery<TeamData>(org.id, '/team');
  const manage = canManage(org.role);
  const [invite, setInvite] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<OrgRole>('staff');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [roleSheet, setRoleSheet] = useState<TeamMember | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: orgKey(org.id) });

  const sendInvite = async () => {
    setBusy('invite');
    setError(null);
    try {
      const res = await api.post<{ result: 'added' | 'invited' }>(`/org/${org.id}/team`, { email: email.trim(), role: role === 'owner' ? 'admin' : role });
      await refresh();
      toast({ message: res.result === 'added' ? 'Personen er lagt til i teamet' : 'Invitasjonen er sendt', tone: 'success' });
      setInvite(false);
      setEmail('');
    } catch (err) {
      setError(err instanceof ApiError && err.fields?.email ? err.fields.email : errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const changeRole = async (m: TeamMember, next: OrgRole) => {
    setBusy(m.id);
    try {
      await api.patch(`/org/${org.id}/team/${m.id}`, { role: next });
      await refresh();
      setRoleSheet(null);
      toast({ message: `${m.name} er nå ${roleLabel(next).toLowerCase()}`, tone: 'success' });
    } catch (err) {
      toast({ message: errorMessage(err), tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const remove = async (m: TeamMember) => {
    const self = m.userId === me?.id;
    const ok = await confirm({
      title: self ? 'Forlate teamet?' : `Fjerne ${m.name}?`,
      message: self ? 'Du mister tilgangen til arrangøren.' : 'Personen mister tilgangen til arrangøren med en gang.',
      confirmLabel: self ? 'Forlat' : 'Fjern',
      destructive: true,
    });
    if (!ok) return;
    setBusy(m.id);
    try {
      await api.del(`/org/${org.id}/team/${m.id}`);
      await refresh();
      setRoleSheet(null);
      toast({ message: self ? 'Du har forlatt teamet' : `${m.name} er fjernet`, tone: 'success' });
    } catch (err) {
      toast({ message: errorMessage(err), tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Page title="Team" back={`/arrangor/${org.id}/innstillinger`}>
      {q.isLoading && <CenterSpinner />}
      {q.isError && <QueryError error={q.error} onRetry={() => void q.refetch()} />}
      {q.data && (
        <div className="mx-4">
          {manage && (
            <Button className="mb-5" icon={<UserPlus className="h-4 w-4" />} onClick={() => setInvite(true)}>
              Legg til person
            </Button>
          )}
          <h2 className="mb-1.5 px-4 text-footnote uppercase tracking-[0.02em] text-label-2">Medlemmer</h2>
          <ul className="mb-6 overflow-hidden rounded-md bg-grouped-2 [&>*+*]:hairline-t">
            {q.data.members.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  disabled={!(manage || m.userId === me?.id)}
                  onClick={() => setRoleSheet(m)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors enabled:hover:bg-fill-4"
                >
                  <Avatar name={m.name} size={38} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body font-medium">
                      {m.name}
                      {m.userId === me?.id ? ' (deg)' : ''}
                    </span>
                    <span className="block truncate text-footnote text-label-2">{m.email ?? 'Ingen e-post'}</span>
                  </span>
                  <Pill tone={m.role === 'owner' ? 'tint' : 'neutral'}>{roleLabel(m.role)}</Pill>
                </button>
              </li>
            ))}
          </ul>
          {q.data.invites.length > 0 && (
            <>
              <h2 className="mb-1.5 px-4 text-footnote uppercase tracking-[0.02em] text-label-2">Invitert – venter på innlogging</h2>
              <ul className="mb-6 overflow-hidden rounded-md bg-grouped-2 [&>*+*]:hairline-t">
                {q.data.invites.map((i) => (
                  <li key={i.id} className="flex items-center gap-3 px-4 py-3">
                    <Mail className="h-5 w-5 shrink-0 text-label-2" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate text-body">{i.email}</span>
                    <Pill tone="neutral">{roleLabel(i.role)}</Pill>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="mb-6 px-4 text-footnote text-label-2">Personer som ikke har TIKIT ennå, legges til automatisk første gang de logger inn med samme e-postadresse.</p>
        </div>
      )}

      <Sheet open={invite} onClose={() => setInvite(false)} locked={busy === 'invite'} title="Legg til person">
        <form
          className="flex flex-col gap-4 pb-2"
          onSubmit={(e) => {
            e.preventDefault();
            void sendInvite();
          }}
        >
          <TextField label="E-post" type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} error={error} autoComplete="off" data-autofocus />
          <SelectField
            label="Rolle"
            value={role}
            onChange={(e) => setRole(e.target.value as OrgRole)}
            options={ROLES.filter((r) => r.id !== 'owner').map((r) => ({ value: r.id, label: `${r.label} – ${r.detail}` }))}
          />
          <Button type="submit" size="lg" full loading={busy === 'invite'} disabled={!email.trim()}>
            Legg til
          </Button>
        </form>
      </Sheet>

      <Sheet open={!!roleSheet} onClose={() => setRoleSheet(null)} title={roleSheet?.name}>
        {roleSheet && (
          <div className="flex flex-col gap-3 pb-2">
            {manage && (
              <div role="radiogroup" aria-label="Rolle" className="overflow-hidden rounded-md bg-grouped-2 [&>*+*]:hairline-t">
                {ROLES.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    role="radio"
                    aria-checked={roleSheet.role === r.id}
                    disabled={busy === roleSheet.id || (r.id === 'owner' && org.role !== 'owner')}
                    onClick={() => void changeRole(roleSheet, r.id)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left disabled:opacity-50"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-body">{r.label}</span>
                      <span className="block text-footnote text-label-2">{r.detail}</span>
                    </span>
                    {roleSheet.role === r.id && <Check className="h-5 w-5 text-tint" aria-hidden="true" />}
                  </button>
                ))}
              </div>
            )}
            <Button variant="destructive" full loading={busy === roleSheet.id} onClick={() => void remove(roleSheet)}>
              {roleSheet.userId === me?.id ? 'Forlat teamet' : 'Fjern fra teamet'}
            </Button>
          </div>
        )}
      </Sheet>
    </Page>
  );
}
