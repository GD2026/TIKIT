import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Plus, Trash2 } from 'lucide-react';
import type { EventDoc, EventSettings, LineupItem, PosterSpec } from '../../shared/types';
import type { OrgEventDetail } from '../../server/services/events';
import { CATEGORIES, CATEGORY_IDS, CITIES, LIMITS, REFUND_POLICIES, type CategoryId, type RefundPolicyId } from '../../shared/constants';
import { formatNok, parseKroner } from '../../shared/money';
import { osloLocalToUtc, osloParts, toOsloInput } from '../../shared/time';
import { useApi } from '../app/context';
import { ApiError, errorMessage } from '../api/client';
import { Page } from '../components/layout/Page';
import { BottomBar } from '../components/layout/BottomBar';
import { SelectField, TextArea, TextField } from '../components/ui/Field';
import { Button } from '../components/ui/Button';
import { SegmentedControl, Stepper } from '../components/ui/Controls';
import { ToggleRow } from '../components/ui/List';
import { CenterSpinner, QueryError } from '../components/ui/States';
import { useToast } from '../components/ui/Overlays';
import { ImageUpload, PosterDesigner } from './Pickers';
import { canManage, orgKey, useOrg, useOrgQuery } from './shared';

interface TypeDraft {
  key: string;
  name: string;
  price: string;
  capacity: string;
}

interface FormState {
  title: string;
  subtitle: string;
  description: string;
  category: CategoryId;
  visibility: 'public' | 'unlisted';
  startsAt: string;
  endsAt: string;
  doorsAt: string;
  salesStartAt: string;
  salesEndAt: string;
  venueName: string;
  address: string;
  postalCode: string;
  city: string;
  ageLimit: string;
  poster: PosterSpec;
  coverImageId: string | null;
  lineup: (LineupItem & { key: string })[];
  tags: string[];
  settings: EventSettings;
}

const AGE_OPTIONS = ['', '13', '15', '16', '17', '18', '19', '20', '21', '23', '25'];
let keySeq = 0;
const nextKey = () => `k${++keySeq}`;

function nextSaturdayLocal(hour: number): string {
  const now = new Date();
  const p = osloParts(now);
  const days = (6 - p.weekday + 7) % 7 || 7;
  const target = new Date(now.getTime() + days * 86400000);
  const t = osloParts(target);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${t.year}-${pad(t.month)}-${pad(t.day)}T${pad(hour)}:00`;
}

function addHoursLocal(local: string, hours: number): string {
  try {
    return toOsloInput(new Date(osloLocalToUtc(local).getTime() + hours * 3600000));
  } catch {
    return local;
  }
}

function defaults(): FormState {
  const start = nextSaturdayLocal(20);
  return {
    title: '',
    subtitle: '',
    description: '',
    category: 'russetreff',
    visibility: 'public',
    startsAt: start,
    endsAt: addHoursLocal(start, 6),
    doorsAt: '',
    salesStartAt: '',
    salesEndAt: '',
    venueName: '',
    address: '',
    postalCode: '',
    city: 'Stavanger',
    ageLimit: '18',
    poster: { style: 'aurora', palette: 'blatime', seed: Math.floor(Math.random() * 1_000_000) },
    coverImageId: null,
    lineup: [],
    tags: [],
    settings: {
      maxPerOrder: LIMITS.defaultMaxPerOrder,
      personalizedTickets: false,
      transfersAllowed: true,
      resaleAllowed: true,
      refundPolicy: 'until-48h',
      queueEnabled: false,
      queueRatePerMinute: 200,
      waitlistEnabled: true,
      showRemaining: false,
      requireVerifiedAge: false,
    },
  };
}

function fromEvent(e: EventDoc): FormState {
  return {
    title: e.title,
    subtitle: e.subtitle,
    description: e.description,
    // Events saved before the categories were cut to four keep working (and can be saved again).
    category: (CATEGORY_IDS as readonly string[]).includes(e.category) ? e.category : 'annet',
    visibility: e.visibility,
    startsAt: toOsloInput(e.startsAt),
    endsAt: toOsloInput(e.endsAt),
    doorsAt: e.doorsAt ? toOsloInput(e.doorsAt) : '',
    salesStartAt: e.salesStartAt ? toOsloInput(e.salesStartAt) : '',
    salesEndAt: e.salesEndAt ? toOsloInput(e.salesEndAt) : '',
    venueName: e.venue.name,
    address: e.venue.address,
    postalCode: e.venue.postalCode,
    city: e.venue.city,
    ageLimit: e.ageLimit === null ? '' : String(e.ageLimit),
    poster: e.poster,
    coverImageId: e.coverImageId,
    lineup: e.lineup.map((l) => ({ ...l, key: nextKey() })),
    tags: e.tags,
    settings: e.settings,
  };
}

function Group({ title, children, footer }: { title: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="mb-1.5 px-4 text-footnote uppercase tracking-[0.02em] text-label-2">{title}</h2>
      <div className="flex flex-col gap-4 rounded-md bg-grouped-2 p-4">{children}</div>
      {footer && <p className="mt-1.5 px-4 text-footnote text-label-2">{footer}</p>}
    </section>
  );
}

function toIso(local: string): string | null {
  if (!local) return null;
  try {
    return osloLocalToUtc(local).toISOString();
  } catch {
    return null;
  }
}

function Editor({ existing }: { existing: OrgEventDetail | null }) {
  const { org } = useOrg();
  const api = useApi();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const [f, setF] = useState<FormState>(() => (existing ? fromEvent(existing.event) : defaults()));
  const [types, setTypes] = useState<TypeDraft[]>(() => (existing ? [] : [{ key: nextKey(), name: 'Ordinær', price: '349', capacity: '300' }]));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  // Opened once for events that use these settings; after that the organizer decides (it must not snap shut
  // while they are toggling things inside it).
  const [moreOpen, setMoreOpen] = useState(() => f.settings.personalizedTickets || f.settings.queueEnabled || f.settings.showRemaining);
  const isNew = !existing;

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setF((prev) => ({ ...prev, [key]: value }));
  const setSetting = <K extends keyof EventSettings>(key: K, value: EventSettings[K]) => setF((prev) => ({ ...prev, settings: { ...prev.settings, [key]: value } }));
  const err = (key: string) => errors[key] || null;

  // Keep the end after the start when the start moves.
  useEffect(() => {
    if (!f.startsAt || !f.endsAt) return;
    const s = toIso(f.startsAt);
    const e = toIso(f.endsAt);
    if (s && e && e <= s) set('endsAt', addHoursLocal(f.startsAt, 5));
  }, [f.startsAt]); // eslint-disable-line

  const buildBody = () => ({
    title: f.title.trim(),
    subtitle: f.subtitle.trim(),
    description: f.description.trim(),
    category: f.category,
    visibility: f.visibility,
    startsAt: toIso(f.startsAt),
    endsAt: toIso(f.endsAt),
    doorsAt: toIso(f.doorsAt),
    salesStartAt: toIso(f.salesStartAt),
    salesEndAt: toIso(f.salesEndAt),
    venue: { name: f.venueName.trim(), address: f.address.trim(), postalCode: f.postalCode.trim(), city: f.city.trim() },
    ageLimit: f.ageLimit === '' ? null : Number(f.ageLimit),
    poster: f.poster,
    coverImageId: f.coverImageId,
    lineup: f.lineup.filter((l) => l.name.trim()).map((l) => ({ name: l.name.trim(), time: l.time || null })),
    tags: f.tags,
    settings: { ...f.settings, requireVerifiedAge: f.ageLimit !== '' && f.settings.requireVerifiedAge },
  });

  const validate = (): Record<string, string> => {
    const e: Record<string, string> = {};
    if (f.title.trim().length < 3) e.title = 'Tittelen må ha minst 3 tegn.';
    if (!toIso(f.startsAt)) e.startsAt = 'Velg når arrangementet starter.';
    if (!toIso(f.endsAt)) e.endsAt = 'Velg når arrangementet slutter.';
    if (f.venueName.trim().length < 2) e['venue.name'] = 'Skriv navnet på stedet.';
    if (f.city.trim().length < 2) e['venue.city'] = 'Skriv byen.';
    if (f.postalCode && !/^\d{4}$/.test(f.postalCode.trim())) e['venue.postalCode'] = 'Postnummer har 4 siffer.';
    types.forEach((t, i) => {
      if (t.name.trim().length < 2) e[`ticketTypes.${i}.name`] = 'Skriv et navn.';
      if (parseKroner(t.price) === null) e[`ticketTypes.${i}.priceOre`] = 'Skriv en pris, 0 for gratis.';
      const cap = Number(t.capacity);
      if (!Number.isInteger(cap) || cap < 1) e[`ticketTypes.${i}.capacity`] = 'Minst 1.';
    });
    return e;
  };

  const save = async () => {
    const local = validate();
    setErrors(local);
    if (Object.keys(local).length > 0) {
      toast({ message: 'Noen felt må rettes', tone: 'error' });
      return;
    }
    setBusy(true);
    try {
      const event = buildBody();
      if (isNew) {
        const ticketTypes = types.map((t, i) => ({ name: t.name.trim(), priceOre: parseKroner(t.price) ?? 0, capacity: Number(t.capacity), sortOrder: i }));
        const created = await api.post<EventDoc>(`/org/${org.id}/events`, { event, ticketTypes });
        await qc.invalidateQueries({ queryKey: orgKey(org.id) });
        toast({ message: 'Arrangementet er lagret som utkast', tone: 'success' });
        navigate(`/arrangor/${org.id}/arrangementer/${created.id}`, { replace: true });
      } else {
        await api.put<EventDoc>(`/org/${org.id}/events/${existing.event.id}`, { event });
        await qc.invalidateQueries({ queryKey: orgKey(org.id) });
        await qc.invalidateQueries({ queryKey: ['event'] });
        toast({ message: 'Endringene er lagret', tone: 'success' });
        navigate(`/arrangor/${org.id}/arrangementer/${existing.event.id}`, { replace: true });
      }
    } catch (e) {
      if (e instanceof ApiError && e.fields) {
        const mapped: Record<string, string> = {};
        for (const [k, v] of Object.entries(e.fields)) mapped[k.replace(/^event\./, '')] = v;
        setErrors(mapped);
      }
      toast({ message: errorMessage(e), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const hasSales = existing?.hasSales ?? false;

  return (
    <form
      noValidate
      className="mx-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <Group title="Grunninfo">
        <TextField label="Tittel" value={f.title} onChange={(e) => set('title', e.target.value)} maxLength={LIMITS.titleMax} required error={err('title')} placeholder="For eksempel Russetreff Vest" />
        <TextField label="Undertittel (valgfritt)" value={f.subtitle} onChange={(e) => set('subtitle', e.target.value)} maxLength={120} error={err('subtitle')} />
        <SelectField label="Kategori" value={f.category} onChange={(e) => set('category', e.target.value as CategoryId)} options={CATEGORIES.map((c) => ({ value: c.id, label: c.label }))} error={err('category')} />
        <TextArea label="Beskrivelse" value={f.description} onChange={(e) => set('description', e.target.value)} rows={6} maxLength={LIMITS.descriptionMax} error={err('description')} hint="Hva skjer, hvem spiller, hva er inkludert, garderobe, dresscode …" />
        <div>
          <p className="mb-2 px-1 text-subhead font-medium text-label-2">Synlighet</p>
          <SegmentedControl
            label="Synlighet"
            value={f.visibility}
            onChange={(v) => set('visibility', v)}
            options={[
              { value: 'public', label: 'Offentlig' },
              { value: 'unlisted', label: 'Bare med lenke' },
            ]}
          />
          <p className="mt-1.5 px-1 text-footnote text-label-2">{f.visibility === 'public' ? 'Vises i søk og på forsiden.' : 'Vises ikke i søk – bare for dem som har lenken.'}</p>
        </div>
      </Group>

      <Group title="Tid" footer="Tidene gjelder norsk tid. Tom salgsstart betyr at salget åpner når dere publiserer.">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Starter" type="datetime-local" value={f.startsAt} onChange={(e) => set('startsAt', e.target.value)} required error={err('startsAt')} />
          <TextField label="Slutter" type="datetime-local" value={f.endsAt} onChange={(e) => set('endsAt', e.target.value)} required error={err('endsAt')} />
          <TextField label="Dørene åpner (valgfritt)" type="datetime-local" value={f.doorsAt} onChange={(e) => set('doorsAt', e.target.value)} error={err('doorsAt')} />
          <div className="hidden sm:block" />
          <TextField label="Salget åpner (valgfritt)" type="datetime-local" value={f.salesStartAt} onChange={(e) => set('salesStartAt', e.target.value)} error={err('salesStartAt')} />
          <TextField label="Salget stenger (valgfritt)" type="datetime-local" value={f.salesEndAt} onChange={(e) => set('salesEndAt', e.target.value)} error={err('salesEndAt')} />
        </div>
      </Group>

      <Group title="Sted">
        <TextField label="Stedets navn" value={f.venueName} onChange={(e) => set('venueName', e.target.value)} required maxLength={80} error={err('venue.name')} placeholder="For eksempel Havnehallen" />
        <TextField label="Adresse" value={f.address} onChange={(e) => set('address', e.target.value)} maxLength={120} error={err('venue.address')} autoComplete="street-address" />
        <div className="grid grid-cols-[120px_1fr] gap-3">
          <TextField label="Postnr." inputMode="numeric" value={f.postalCode} onChange={(e) => set('postalCode', e.target.value)} maxLength={4} error={err('venue.postalCode')} />
          <TextField label="By" value={f.city} onChange={(e) => set('city', e.target.value)} list="tikit-cities" required maxLength={60} error={err('venue.city')} />
        </div>
        <datalist id="tikit-cities">
          {CITIES.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </Group>

      <Group title="Plakat" footer="Uten eget bilde lager TIKIT en plakat i fargene dere velger.">
        <PosterDesigner poster={f.poster} onChange={(p) => set('poster', p)} title={f.title} />
        <div className="hairline-t pt-4">
          <ImageUpload imageId={f.coverImageId} onChange={(id) => set('coverImageId', id)} label="Last opp eget bilde" />
        </div>
      </Group>

      <Group title="Program (valgfritt)">
        {f.lineup.map((l, i) => (
          <div key={l.key} className="flex items-end gap-2">
            <TextField
              label={`Navn ${i + 1}`}
              labelHidden
              placeholder="Artist eller programpost"
              value={l.name}
              onChange={(e) => set('lineup', f.lineup.map((x) => (x.key === l.key ? { ...x, name: e.target.value } : x)))}
              maxLength={60}
              className="flex-1"
            />
            <TextField
              label={`Tid ${i + 1}`}
              labelHidden
              type="time"
              value={l.time ?? ''}
              onChange={(e) => set('lineup', f.lineup.map((x) => (x.key === l.key ? { ...x, time: e.target.value || null } : x)))}
              className="w-28"
            />
            <button
              type="button"
              aria-label={`Fjern ${l.name || `programpost ${i + 1}`}`}
              onClick={() => set('lineup', f.lineup.filter((x) => x.key !== l.key))}
              className="flex h-12 w-11 shrink-0 items-center justify-center rounded-[12px] text-red hover:bg-red-soft"
            >
              <Trash2 className="h-5 w-5" />
            </button>
          </div>
        ))}
        {f.lineup.length < 30 && (
          <Button variant="tinted" size="sm" className="self-start" icon={<Plus className="h-4 w-4" />} onClick={() => set('lineup', [...f.lineup, { key: nextKey(), name: '', time: null }])}>
            Legg til programpost
          </Button>
        )}
      </Group>

      <Group title="Alder">
        <SelectField
          label="Aldersgrense"
          value={f.ageLimit}
          onChange={(e) => set('ageLimit', e.target.value)}
          options={AGE_OPTIONS.map((a) => ({ value: a, label: a === '' ? 'Ingen aldersgrense' : `${a} år` }))}
        />
        {f.ageLimit !== '' && (
          <div className="-mx-4 -mb-4 hairline-t">
            <ToggleRow
              id="require-age"
              title="Krev alder bekreftet med Vipps"
              subtitle="Bare kjøpere med Vipps-bekreftet fødselsdato kan kjøpe. Skanneren varsler uansett om alder."
              checked={f.settings.requireVerifiedAge}
              onChange={(v) => setSetting('requireVerifiedAge', v)}
            />
          </div>
        )}
      </Group>

      <Group title="Salg og regler">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-body">Maks billetter per kjøp</p>
            <p className="text-footnote text-label-2">Hindrer oppkjøp for videresalg</p>
          </div>
          <Stepper value={f.settings.maxPerOrder} min={1} max={LIMITS.maxTicketsPerOrder} onChange={(v) => setSetting('maxPerOrder', v)} label="Maks billetter per kjøp" />
        </div>
        <SelectField
          label="Refusjon"
          value={f.settings.refundPolicy}
          onChange={(e) => setSetting('refundPolicy', e.target.value as RefundPolicyId)}
          options={REFUND_POLICIES.map((p) => ({ value: p.id, label: p.label }))}
          hint={REFUND_POLICIES.find((p) => p.id === f.settings.refundPolicy)?.description}
        />
        <div className="-mx-4 -mb-4 hairline-t [&>*+*]:hairline-t">
          <ToggleRow id="s-transfer" title="Tillat overføring" subtitle="Kjøpere kan gi billetten til en venn" checked={f.settings.transfersAllowed} onChange={(v) => setSetting('transfersAllowed', v)} />
          <ToggleRow id="s-resale" title="Tillat videresalg i TIKIT" subtitle="Til maks prisen kjøperen betalte" checked={f.settings.resaleAllowed} onChange={(v) => setSetting('resaleAllowed', v)} />
          <ToggleRow id="s-wait" title="Venteliste når det er utsolgt" subtitle="Vi varsler automatisk når billetter blir ledige" checked={f.settings.waitlistEnabled} onChange={(v) => setSetting('waitlistEnabled', v)} />
        </div>
      </Group>

      {/* Rarely needed – kept out of the way so a normal event is quick to set up. */}
      <details className="group mb-6" open={moreOpen} onToggle={(e) => setMoreOpen(e.currentTarget.open)}>
        <summary className="mx-4 flex min-h-11 cursor-pointer list-none items-center justify-between rounded-md bg-grouped-2 px-4 text-body font-medium text-tint [&::-webkit-details-marker]:hidden">
          Flere innstillinger
          <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" aria-hidden="true" />
        </summary>
        <div className="mx-4 mt-2 overflow-hidden rounded-md bg-grouped-2 [&>*+*]:hairline-t">
          <ToggleRow id="s-person" title="Personlige billetter" subtitle="Navn må fylles inn på hver billett" checked={f.settings.personalizedTickets} onChange={(v) => setSetting('personalizedTickets', v)} />
          <ToggleRow id="s-remaining" title="Vis antall billetter igjen" subtitle="Ellers vises bare «Få igjen» når det nærmer seg" checked={f.settings.showRemaining} onChange={(v) => setSetting('showRemaining', v)} />
          <ToggleRow id="s-queue" title="Digital kø ved billettslipp" subtitle="For arrangementer med stor pågang" checked={f.settings.queueEnabled} onChange={(v) => setSetting('queueEnabled', v)} />
          {f.settings.queueEnabled && (
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <div>
                <p className="text-body">Slipp inn per minutt</p>
                <p className="text-footnote text-label-2">Hvor mange fra køen som får handle hvert minutt</p>
              </div>
              <input
                type="number"
                inputMode="numeric"
                min={5}
                max={5000}
                step={5}
                value={f.settings.queueRatePerMinute}
                onChange={(e) => setSetting('queueRatePerMinute', Math.max(5, Math.min(5000, Number(e.target.value) || 5)))}
                className="h-11 w-24 rounded-[12px] bg-fill-3 px-3 text-right text-body tabular outline-none focus:shadow-[0_0_0_2px_var(--tint)]"
                aria-label="Slipp inn per minutt"
              />
            </div>
          )}
        </div>
      </details>

      {isNew && (
        <Group title="Billetter" footer="Flere valg (skjulte billettyper, tilgangskoder, salgstider, mva.) finner du under Billettyper etterpå.">
          {types.map((t, i) => (
            <div key={t.key} className="grid grid-cols-[1fr_1fr_44px] items-end gap-2 sm:grid-cols-[1fr_96px_88px_44px]">
              <div className="col-span-3 sm:col-span-1">
              <TextField label="Navn" labelHidden={i > 0} value={t.name} onChange={(e) => setTypes(types.map((x) => (x.key === t.key ? { ...x, name: e.target.value } : x)))} maxLength={60} error={err(`ticketTypes.${i}.name`)} placeholder="Ordinær" />
              </div>
              <TextField label="Pris (kr)" inputMode="decimal" value={t.price} onChange={(e) => setTypes(types.map((x) => (x.key === t.key ? { ...x, price: e.target.value } : x)))} error={err(`ticketTypes.${i}.priceOre`)} />
              <TextField label="Antall" inputMode="numeric" value={t.capacity} onChange={(e) => setTypes(types.map((x) => (x.key === t.key ? { ...x, capacity: e.target.value } : x)))} error={err(`ticketTypes.${i}.capacity`)} />
              <button
                type="button"
                aria-label={`Fjern billettypen ${t.name || i + 1}`}
                onClick={() => setTypes(types.filter((x) => x.key !== t.key))}
                className="flex h-12 w-11 items-center justify-center rounded-[12px] text-red hover:bg-red-soft"
              >
                <Trash2 className="h-5 w-5" />
              </button>
            </div>
          ))}
          <Button variant="tinted" size="sm" className="self-start" icon={<Plus className="h-4 w-4" />} onClick={() => setTypes([...types, { key: nextKey(), name: '', price: '', capacity: '100' }])} disabled={types.length >= LIMITS.ticketTypesMax}>
            Legg til billettype
          </Button>
          {types.length > 0 && (
            <p className="text-footnote text-label-2 tabular">
              Kjøperen betaler i tillegg servicegebyr til TIKIT. Dere får hele billettprisen: {types.map((t) => (parseKroner(t.price) ?? 0) > 0 ? formatNok(parseKroner(t.price) ?? 0) : 'gratis').join(', ')}.
            </p>
          )}
        </Group>
      )}

      {hasSales && <p className="mb-4 px-4 text-footnote text-label-2">Arrangementet har solgte billetter. Endrer dere tid eller sted, varsler vi alle som har billett.</p>}

      <BottomBar aboveTabBar>
        <Button type="submit" size="lg" full loading={busy}>
          {isNew ? 'Lagre som utkast' : 'Lagre endringer'}
        </Button>
      </BottomBar>
    </form>
  );
}

export default function EventEditor() {
  const { eventId } = useParams();
  const { org } = useOrg();
  const q = useOrgQuery<OrgEventDetail>(org.id, `/events/${eventId}`, { enabled: !!eventId });
  const title = eventId ? 'Rediger arrangement' : 'Nytt arrangement';
  const back = eventId ? `/arrangor/${org.id}/arrangementer/${eventId}` : `/arrangor/${org.id}/arrangementer`;
  const content = (() => {
    if (!canManage(org.role)) return <QueryError error={new ApiError('forbidden', 'Du må være administrator for å endre arrangementer.', 403)} />;
    if (!eventId) return <Editor existing={null} />;
    if (q.isLoading) return <CenterSpinner />;
    if (q.isError || !q.data) return <QueryError error={q.error} onRetry={() => void q.refetch()} />;
    if (q.data.event.status === 'cancelled') return <QueryError error={new ApiError('event_cancelled', 'Arrangementet er avlyst og kan ikke endres.', 409)} />;
    return <Editor key={q.data.event.id} existing={q.data} />;
  })();
  return (
    <Page title={title} back={back} wide>
      <div className="mx-auto max-w-3xl">{content}</div>
    </Page>
  );
}
