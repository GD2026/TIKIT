import { useState } from 'react';
import { CITIES, ORGANIZER_TYPES, type OrganizerTypeId, type PosterPaletteId } from '../../shared/constants';
import { ApiError, errorMessage } from '../api/client';
import { SelectField, TextArea, TextField } from '../components/ui/Field';
import { Button } from '../components/ui/Button';
import { useToast } from '../components/ui/Overlays';
import { ImageUpload, PalettePicker } from './Pickers';

export interface OrgFormValues {
  name: string;
  type: OrganizerTypeId;
  orgNumber: string;
  description: string;
  city: string;
  email: string;
  phone: string;
  website: string;
  payoutAccount: string;
  palette: PosterPaletteId;
  logoImageId: string | null;
}

export function emptyOrgValues(email: string | null): OrgFormValues {
  return { name: '', type: 'russ', orgNumber: '', description: '', city: '', email: email ?? '', phone: '', website: '', payoutAccount: '', palette: 'blatime', logoImageId: null };
}

function Group({ title, children, footer }: { title: string; children: React.ReactNode; footer?: string }) {
  return (
    <section className="mb-6">
      <h2 className="mb-1.5 px-4 text-footnote uppercase tracking-[0.02em] text-label-2">{title}</h2>
      <div className="flex flex-col gap-4 rounded-md bg-grouped-2 p-4">{children}</div>
      {footer && <p className="mt-1.5 px-4 text-footnote text-label-2">{footer}</p>}
    </section>
  );
}

export function OrgForm({ initial, submitLabel, onSubmit }: { initial: OrgFormValues; submitLabel: string; onSubmit: (body: Record<string, unknown>) => Promise<void> }) {
  const toast = useToast();
  const [v, setV] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof OrgFormValues>(key: K, value: OrgFormValues[K]) => {
    setV((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: '' }));
  };

  const submit = async () => {
    const local: Record<string, string> = {};
    if (v.name.trim().length < 2) local.name = 'Skriv navnet på arrangøren.';
    if (!v.email.trim()) local.email = 'Skriv en e-postadresse.';
    if (Object.keys(local).length) {
      setErrors(local);
      return;
    }
    setBusy(true);
    try {
      await onSubmit({
        name: v.name.trim(),
        type: v.type,
        orgNumber: v.orgNumber.trim() || null,
        description: v.description.trim(),
        city: v.city || null,
        email: v.email.trim(),
        phone: v.phone.trim() || null,
        website: v.website.trim() || null,
        payoutAccount: v.payoutAccount.trim() || null,
        palette: v.palette,
        logoImageId: v.logoImageId,
      });
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      toast({ message: errorMessage(err), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      noValidate
      className="mx-4 pb-8"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Group title="Om arrangøren">
        <TextField label="Navn" value={v.name} onChange={(e) => set('name', e.target.value)} required maxLength={80} error={errors.name} placeholder="For eksempel Russebussen Blåtimen" />
        <SelectField label="Type" value={v.type} onChange={(e) => set('type', e.target.value as OrganizerTypeId)} options={ORGANIZER_TYPES.map((t) => ({ value: t.id, label: t.label }))} />
        <TextArea label="Beskrivelse" value={v.description} onChange={(e) => set('description', e.target.value)} rows={3} maxLength={1000} error={errors.description} hint="Vises på arrangørsiden i appen." />
        <SelectField label="By" value={v.city} onChange={(e) => set('city', e.target.value)} options={[{ value: '', label: 'Ikke valgt' }, ...CITIES.map((c) => ({ value: c, label: c }))]} />
      </Group>
      <Group title="Profil">
        <ImageUpload imageId={v.logoImageId} onChange={(id) => set('logoImageId', id)} label="Last opp logo" aspect="aspect-square" />
        <div>
          <p className="mb-2 text-subhead font-medium text-label-2">Profilfarger</p>
          <PalettePicker value={v.palette} onChange={(p) => set('palette', p)} label="Profilfarger" />
        </div>
      </Group>
      <Group title="Kontakt" footer="E-postadressen vises på kvitteringer, så kjøpere kan kontakte dere.">
        <TextField label="E-post" type="email" inputMode="email" value={v.email} onChange={(e) => set('email', e.target.value)} required autoComplete="email" error={errors.email} />
        <TextField label="Telefon (valgfritt)" type="tel" inputMode="tel" value={v.phone} onChange={(e) => set('phone', e.target.value)} error={errors.phone} />
        <TextField label="Nettside (valgfritt)" type="url" inputMode="url" value={v.website} onChange={(e) => set('website', e.target.value)} placeholder="https://" error={errors.website} />
      </Group>
      <Group title="Oppgjør" footer="Organisasjonsnummer trengs for kvitteringer. Russegrupper uten organisasjonsnummer kan bruke kontonummeret til den ansvarlige.">
        <TextField label="Organisasjonsnummer (valgfritt)" inputMode="numeric" value={v.orgNumber} onChange={(e) => set('orgNumber', e.target.value)} maxLength={11} placeholder="9 siffer" error={errors.orgNumber} />
        <TextField label="Kontonummer for utbetaling" inputMode="numeric" value={v.payoutAccount} onChange={(e) => set('payoutAccount', e.target.value)} maxLength={14} placeholder="1234 56 78901" error={errors.payoutAccount} />
      </Group>
      <Button type="submit" size="lg" full loading={busy}>
        {submitLabel}
      </Button>
    </form>
  );
}
