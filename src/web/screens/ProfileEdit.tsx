import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { BadgeCheck } from 'lucide-react';
import { CITIES } from '../../shared/constants';
import type { Me } from '../../shared/types';
import { useApi } from '../app/context';
import { useAuth } from '../app/auth';
import { qk, type MeResponse } from '../api/hooks';
import { ApiError, errorMessage } from '../api/client';
import { Page } from '../components/layout/Page';
import { SelectField, TextField } from '../components/ui/Field';
import { Button } from '../components/ui/Button';
import { RequireLogin } from '../components/ui/States';
import { useToast } from '../components/ui/Overlays';
import { osloDateKey } from '../../shared/time';

function formatPhoneForInput(phone: string | null): string {
  if (!phone) return '';
  const local = phone.replace(/^\+47/, '');
  return /^\d{8}$/.test(local) ? `${local.slice(0, 3)} ${local.slice(3, 5)} ${local.slice(5)}` : phone;
}

function EditForm({ me }: { me: Me }) {
  const api = useApi();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const [name, setName] = useState(me.name);
  const [email, setEmail] = useState(me.email ?? '');
  const [phone, setPhone] = useState(formatPhoneForInput(me.phone));
  const [birthdate, setBirthdate] = useState(me.birthdate ?? '');
  const [city, setCity] = useState(me.city ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setName(me.name);
  }, [me.name]);

  const save = async () => {
    setBusy(true);
    setErrors({});
    const body: Record<string, unknown> = {};
    if (!me.birthdateVerified && name.trim() !== me.name) body.name = name.trim();
    if ((email.trim() || null) !== me.email) body.email = email.trim() || null;
    const phoneDigits = phone.replace(/\s/g, '');
    if (formatPhoneForInput(me.phone).replace(/\s/g, '') !== phoneDigits) body.phone = phoneDigits || null;
    if (!me.birthdateVerified && (birthdate || null) !== me.birthdate) body.birthdate = birthdate || null;
    if ((city || null) !== me.city) body.city = city || null;
    try {
      if (Object.keys(body).length > 0) {
        const res = await api.patch<{ me: Me }>('/me', body);
        qc.setQueryData<MeResponse>(qk.me, (prev) => ({ scanner: prev?.scanner ?? null, me: res.me }));
        await qc.invalidateQueries({ queryKey: ['home'] });
      }
      toast({ message: 'Profilen er lagret', tone: 'success' });
      navigate('/profil', { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      toast({ message: errorMessage(err), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="mx-4 flex flex-col gap-5 pb-8"
      onSubmit={(ev) => {
        ev.preventDefault();
        void save();
      }}
      noValidate
    >
      {me.birthdateVerified ? (
        <div className="flex flex-col gap-1.5">
          <span className="px-1 text-subhead font-medium text-label-2">Navn</span>
          <div className="flex h-12 items-center gap-2 rounded-[12px] bg-fill-4 px-3.5 text-body">
            <span className="min-w-0 truncate">{me.name}</span>
            <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-footnote font-semibold text-green">
              <BadgeCheck className="h-4 w-4" aria-hidden="true" /> Bekreftet med Vipps
            </span>
          </div>
        </div>
      ) : (
        <TextField label="Navn" value={name} onChange={(ev) => setName(ev.target.value)} autoComplete="name" required maxLength={80} error={errors.name} />
      )}
      <TextField
        label="E-post"
        type="email"
        inputMode="email"
        value={email}
        onChange={(ev) => setEmail(ev.target.value)}
        autoComplete="email"
        maxLength={254}
        error={errors.email}
        hint={me.email && !me.emailVerified ? 'Ikke bekreftet ennå.' : 'Kvitteringer og billetter sendes hit.'}
      />
      <TextField
        label="Mobilnummer"
        type="tel"
        inputMode="tel"
        value={phone}
        onChange={(ev) => setPhone(ev.target.value)}
        autoComplete="tel-national"
        placeholder="912 34 567"
        maxLength={20}
        error={errors.phone}
      />
      {me.birthdateVerified ? (
        <div className="flex flex-col gap-1.5">
          <span className="px-1 text-subhead font-medium text-label-2">Fødselsdato</span>
          <div className="flex h-12 items-center gap-2 rounded-[12px] bg-fill-4 px-3.5 text-body">
            {me.birthdate?.split('-').reverse().join('.')}
            <span className="ml-auto inline-flex items-center gap-1 text-footnote font-semibold text-green">
              <BadgeCheck className="h-4 w-4" aria-hidden="true" /> Bekreftet med Vipps
            </span>
          </div>
        </div>
      ) : (
        <TextField
          label="Fødselsdato"
          type="date"
          value={birthdate}
          onChange={(ev) => setBirthdate(ev.target.value)}
          autoComplete="bday"
          max={osloDateKey(new Date())}
          min="1900-01-01"
          error={errors.birthdate}
          hint="Brukes bare for å sjekke aldersgrenser. Kobler du til Vipps, bekreftes den automatisk."
        />
      )}
      <SelectField
        label="By"
        value={city}
        onChange={(ev) => setCity(ev.target.value)}
        options={[{ value: '', label: 'Ikke valgt' }, ...CITIES.map((c) => ({ value: c, label: c })), ...(me.city && !(CITIES as readonly string[]).includes(me.city) ? [{ value: me.city, label: me.city }] : [])]}
        hint="Vi viser arrangementer i nærheten først."
        error={errors.city}
      />
      <Button type="submit" size="lg" full loading={busy}>
        Lagre
      </Button>
    </form>
  );
}

export default function ProfileEdit() {
  const { me } = useAuth();
  return (
    <Page title="Rediger profil" back="/profil">
      <RequireLogin>{me && <EditForm me={me} />}</RequireLogin>
    </Page>
  );
}
