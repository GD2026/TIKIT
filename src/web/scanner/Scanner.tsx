import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import {
  ChevronLeft,
  CircleAlert,
  CircleCheck,
  CircleX,
  CloudOff,
  FlaskConical,
  Flashlight,
  FlashlightOff,
  Keyboard,
  LogOut,
  Search,
  Settings2,
  ShieldAlert,
  Undo2,
  Users,
} from 'lucide-react';
import type { Attendee, CheckinStats, ScanResult } from '../../server/services/checkin';
import { looksLikeTicketNumber, parseTicketCode, verifyTicketCode } from '../../shared/qr';
import { formatTime } from '../../shared/time';
import { useApi } from '../app/context';
import { useAuth } from '../app/auth';
import { useConfig } from '../api/hooks';
import { ApiError, errorMessage } from '../api/client';
import { Sheet } from '../components/ui/Sheet';
import { Button } from '../components/ui/Button';
import { SearchField, TextField } from '../components/ui/Field';
import { Spinner } from '../components/ui/Feedback';
import { useConfirm, useToast } from '../components/ui/Overlays';
import { CenterSpinner } from '../components/ui/States';
import { useDocumentTitle, useWakeLock } from '../lib/hooks';
import { isDemoBuild } from '../lib/device';
import { safeSession, safeStorage } from '../lib/storage';
import { haptic } from '../lib/haptics';
import { cn } from '../lib/cn';
import { beep, unlockAudio, useQrCamera } from './useQrCamera';

interface ManifestTicket {
  id: string;
  number: string;
  secret: string;
  status: 'valid' | 'used' | 'cancelled' | 'refunded';
  holderName: string;
  typeName: string;
  seat: string | null;
  frozen: boolean;
}

type Tone = 'ok' | 'warn' | 'error' | 'neutral';

interface Shown {
  tone: Tone;
  title: string;
  detail: string | null;
  warning: string | null;
  ticket: ScanResult['ticket'];
  offline?: boolean;
  at: number;
}

function toneOf(r: ScanResult['result']): Tone {
  if (r === 'ok') return 'ok';
  if (r === 'already_used' || r === 'expired_code') return 'warn';
  if (r === 'undo') return 'neutral';
  return 'error';
}

/**
 * Full-screen result colours. Every text colour on them is solid (no alpha) and meets 4.5:1:
 * white on green 5.3:1, black on amber 11.5:1, white on red 5.4:1, white on graphite 11:1.
 */
const TONE_STYLE: Record<Tone, string> = {
  ok: 'bg-[#107c3a] text-white',
  warn: 'bg-[#ffb020] text-black',
  error: 'bg-[#d11a2a] text-white',
  neutral: 'bg-[#3a3a3c] text-white',
};

function ResultCard({ shown, onClose, onUndo, undoing }: { shown: Shown; onClose: () => void; onUndo?: () => void; undoing: boolean }) {
  const reduced = useReducedMotion();
  const Icon = shown.tone === 'ok' ? CircleCheck : shown.tone === 'warn' ? CircleAlert : shown.tone === 'error' ? CircleX : Undo2;
  const t = shown.ticket;
  return (
    <motion.div
      role="alertdialog"
      aria-live="assertive"
      aria-label={shown.title}
      className={cn('absolute inset-0 z-30 flex flex-col px-6 pb-[max(24px,var(--safe-bottom))] pt-[calc(var(--safe-top)+28px)]', TONE_STYLE[shown.tone])}
      initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 1.04 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16 }}
      onClick={onClose}
    >
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <Icon className="h-24 w-24" strokeWidth={2.2} aria-hidden="true" />
        <h2 className="mt-4 text-[2rem] font-extrabold leading-tight">{shown.title}</h2>
        {shown.detail && <p className="mt-2 max-w-sm text-title3">{shown.detail}</p>}
        {t && (
          <div className="mt-6 w-full max-w-sm rounded-[22px] bg-black/20 px-5 py-4 text-left">
            <p className="text-title2 font-bold">{t.holderName}</p>
            <p className="text-body">
              {t.typeName}
              {t.seat ? ` · ${t.seat}` : ''}
            </p>
            <p className="mt-1 font-mono text-subhead">{t.number}</p>
            {t.age !== null && (
              <p className={cn('mt-2 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-subhead font-semibold', shown.tone === 'warn' ? 'bg-white/35' : 'bg-black/25')}>
                {t.age} år {t.ageVerified ? '· bekreftet med Vipps' : '· ikke bekreftet'}
              </p>
            )}
          </div>
        )}
        {shown.warning && (
          <p className="mt-4 flex max-w-sm items-start gap-2 rounded-[16px] bg-black/25 px-4 py-3 text-left text-body font-semibold">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" /> {shown.warning}
          </p>
        )}
        {shown.offline && <p className="mt-3 text-subhead font-semibold">Sjekket uten nett – synkroniseres automatisk</p>}
      </div>
      <div className="flex gap-3" onClick={(e) => e.stopPropagation()}>
        {onUndo && (
          <button type="button" onClick={onUndo} disabled={undoing} className="press flex h-14 flex-1 items-center justify-center gap-2 rounded-full bg-black/25 text-headline font-semibold disabled:opacity-60">
            <Undo2 className="h-5 w-5" aria-hidden="true" /> Angre
          </button>
        )}
        <button type="button" onClick={onClose} className="press flex h-14 flex-[2] items-center justify-center rounded-full bg-white text-headline font-bold text-black">
          Neste
        </button>
      </div>
    </motion.div>
  );
}

function AttendeesSheet({ open, onClose, eventId, onChanged }: { open: boolean; onClose: () => void; eventId: string; onChanged: (res: ScanResult) => void }) {
  const api = useApi();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const q = useQuery<{ attendees: Attendee[] }, ApiError>({ queryKey: ['scanner-attendees', eventId], queryFn: () => api.get(`/checkin/${eventId}/attendees`), enabled: open });
  const term = search.trim().toLowerCase();
  const rows = useMemo(
    () => (q.data?.attendees ?? []).filter((a) => (a.status === 'valid' || a.status === 'used') && (!term || [a.holderName, a.number, a.typeName, a.seat ?? ''].some((v) => v.toLowerCase().includes(term)))).slice(0, 80),
    [q.data, term],
  );
  const act = async (a: Attendee, undo: boolean) => {
    setBusy(a.ticketId);
    try {
      const res = await api.post<ScanResult>('/checkin/manual', { eventId, ticketId: a.ticketId, undo });
      await q.refetch();
      onChanged(res);
    } catch (err) {
      toast({ message: errorMessage(err), tone: 'error' });
    } finally {
      setBusy(null);
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title="Deltakerliste" size="large">
      <SearchField value={search} onChange={setSearch} placeholder="Søk på navn eller billettnummer" label="Søk i deltakere" className="mb-3" />
      {q.isLoading && <CenterSpinner className="min-h-40" />}
      {q.isError && <p className="py-6 text-center text-subhead text-red">{errorMessage(q.error)}</p>}
      <ul className="overflow-hidden rounded-md bg-grouped-2 [&>*+*]:hairline-t">
        {rows.map((a) => (
          <li key={a.ticketId} className="flex items-center gap-3 px-4 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-body font-medium">{a.holderName}</p>
              <p className="truncate text-footnote text-label-2">
                {a.typeName}
                {a.seat ? ` · ${a.seat}` : ''} · {a.number}
              </p>
            </div>
            {a.status === 'used' ? (
              <Button size="sm" variant="gray" loading={busy === a.ticketId} onClick={() => void act(a, true)}>
                Inne {a.checkedInAt ? formatTime(a.checkedInAt) : ''} · angre
              </Button>
            ) : (
              <Button size="sm" loading={busy === a.ticketId} onClick={() => void act(a, false)}>
                Sjekk inn
              </Button>
            )}
          </li>
        ))}
      </ul>
      {q.data && rows.length === 0 && <p className="py-6 text-center text-subhead text-label-2">Ingen treff.</p>}
    </Sheet>
  );
}

export default function Scanner() {
  const { eventId = '' } = useParams();
  const api = useApi();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const toast = useToast();
  const { me, scanner, loading } = useAuth();
  const config = useConfig().data;
  const demo = isDemoBuild || !!config?.demoMode;
  useDocumentTitle('Skanner');
  useWakeLock(true);

  const [shown, setShown] = useState<Shown | null>(null);
  const [processing, setProcessing] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [manual, setManual] = useState('');
  const [undoing, setUndoing] = useState(false);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [gate, setGate] = useState(() => safeStorage.get('tikit-gate') ?? '');
  const [sound, setSound] = useState(() => safeStorage.get('tikit-scan-sound') !== 'off');
  // Check-ins made without network; kept in the tab's session storage so a reload (or an app update) can't lose them.
  const queueKey = `tikit.scanQueue.${eventId ?? ''}`;
  const [queue, setQueue] = useState<{ ticketId: string; at: number }[]>(() => safeSession.getJSON(queueKey, []));
  useEffect(() => {
    if (queue.length) safeSession.setJSON(queueKey, queue);
    else safeSession.remove(queueKey);
  }, [queue, queueKey]);
  const busyRef = useRef(false);
  const lastRef = useRef<{ code: string; at: number }>({ code: '', at: 0 });
  const manifestRef = useRef<Map<string, ManifestTicket> | null>(null);
  const localUsed = useRef(new Set<string>());

  const allowed = !!me || (scanner?.eventId === eventId);
  const stats = useQuery<CheckinStats, ApiError>({
    queryKey: ['checkin-stats', eventId],
    queryFn: () => api.get(`/checkin/${eventId}/stats`),
    enabled: allowed && !!eventId,
    refetchInterval: 15_000,
    retry: (n, err) => err.status >= 500 && n < 2,
  });
  const gateName = gate.trim() || scanner?.label || '';

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  // Offline safety net: keep the event's tickets (with secrets) in memory for validating without network.
  useEffect(() => {
    if (!allowed || !eventId || !stats.data) return;
    let cancelled = false;
    const load = () =>
      api
        .get<{ tickets: ManifestTicket[] }>(`/checkin/${eventId}/manifest`)
        .then((m) => {
          if (!cancelled) manifestRef.current = new Map(m.tickets.map((t) => [t.id, t]));
        })
        .catch(() => {});
    void load();
    const t = window.setInterval(load, 10 * 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [allowed, eventId, api, !!stats.data]); // eslint-disable-line

  // Sync check-ins made offline.
  useEffect(() => {
    if (!online || queue.length === 0) return;
    let cancelled = false;
    void (async () => {
      const remaining: typeof queue = [];
      const rejected: string[] = [];
      for (const item of queue) {
        try {
          const res = await api.post<ScanResult>('/checkin/manual', { eventId, ticketId: item.ticketId, undo: false });
          // Someone else let this ticket in (another door, also offline) – or it was refunded meanwhile.
          if (res.result !== 'ok') rejected.push(`${res.ticket?.holderName ?? 'Ukjent'}: ${res.title.toLowerCase()}`);
        } catch (err) {
          if (err instanceof ApiError && err.code === 'network') remaining.push(item);
          else rejected.push(errorMessage(err));
        }
      }
      if (!cancelled) {
        setQueue(remaining);
        if (rejected.length > 0) {
          toast({
            message: `${rejected.length === 1 ? '1 innsjekk' : `${rejected.length} innsjekk`} uten nett ble avvist – ${rejected.slice(0, 3).join(' · ')}${rejected.length > 3 ? ' …' : ''}`,
            tone: 'error',
          });
          void stats.refetch();
        } else if (remaining.length === 0) {
          toast({ message: 'Innsjekk uten nett er synkronisert', tone: 'success' });
          void stats.refetch();
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [online, queue.length]); // eslint-disable-line

  const present = useCallback(
    (s: Shown) => {
      setShown(s);
      if (sound) beep(s.tone === 'ok' ? 'ok' : s.tone === 'warn' ? 'warn' : s.tone === 'error' ? 'error' : 'ok');
      haptic(s.tone === 'ok' ? 'success' : s.tone === 'warn' ? 'warning' : s.tone === 'error' ? 'error' : 'light');
    },
    [sound],
  );

  const validateOffline = async (raw: string, manual: boolean): Promise<Shown> => {
    const map = manifestRef.current;
    const at = Date.now();
    if (!map) return { tone: 'error', title: 'Uten nett', detail: 'Billettlisten er ikke lastet ned ennå. Bruk deltakerlisten når nettet er tilbake.', warning: null, ticket: null, at };
    const parsed = parseTicketCode(raw);
    let t: ManifestTicket | undefined;
    if (parsed) t = map.get(parsed.ticketId);
    else if (looksLikeTicketNumber(raw)) {
      // A QR code with only the printed number proves nothing – only a number typed by staff is looked up.
      if (!manual) return { tone: 'error', title: 'Ugyldig billett', detail: 'Koden inneholder bare billettnummeret. Be gjesten åpne billetten i TIKIT.', warning: null, ticket: null, offline: true, at };
      t = [...map.values()].find((x) => x.number === raw.trim().toUpperCase());
    }
    if (!t) return { tone: 'error', title: 'Ugyldig billett', detail: 'Fant ikke billetten i listen for dette arrangementet.', warning: null, ticket: null, offline: true, at };
    const info = { id: t.id, number: t.number, typeName: t.typeName, holderName: t.holderName, seat: t.seat, checkedInAt: null, age: null, ageVerified: false };
    if (t.status === 'refunded' || t.status === 'cancelled') return { tone: 'error', title: 'Billetten er ikke gyldig', detail: t.status === 'refunded' ? 'Billetten er refundert.' : 'Billetten er kansellert.', warning: null, ticket: info, offline: true, at };
    if (t.frozen) return { tone: 'error', title: 'Ugyldig billett', detail: 'Billetten er under overføring eller til salgs.', warning: null, ticket: info, offline: true, at };
    if (parsed) {
      const check = await verifyTicketCode(parsed, t.secret, Date.now());
      if (check === 'bad_signature') return { tone: 'error', title: 'Ugyldig billett', detail: 'Koden hører til en eldre versjon av billetten.', warning: null, ticket: info, offline: true, at };
      if (check !== 'ok') return { tone: 'warn', title: 'Utløpt kode', detail: 'Kan være et skjermbilde. Be gjesten åpne billetten i TIKIT.', warning: null, ticket: info, offline: true, at };
    }
    if (t.status === 'used' || localUsed.current.has(t.id)) return { tone: 'warn', title: 'Allerede sjekket inn', detail: null, warning: null, ticket: info, offline: true, at };
    localUsed.current.add(t.id);
    setQueue((q) => [...q, { ticketId: t!.id, at }]);
    return {
      tone: 'ok',
      title: 'Gyldig billett',
      detail: t.seat,
      warning: manual ? `Manuell innsjekk uten nett: sjekk at legitimasjonen stemmer med ${t.holderName}.` : 'Uten nett: sjekk alder og legitimasjon manuelt.',
      ticket: info,
      offline: true,
      at,
    };
  };

  const handleCode = useCallback(
    async (raw: string, manual = false) => {
      const code = raw.trim();
      if (!code || busyRef.current) return;
      const now = Date.now();
      if (code === lastRef.current.code && now - lastRef.current.at < 4000) return;
      lastRef.current = { code, at: now };
      busyRef.current = true;
      setProcessing(true);
      try {
        const res = await api.post<ScanResult>('/checkin', { eventId, code, gate: gateName || null, ...(manual ? { manual: true } : {}) });
        qc.setQueryData<CheckinStats>(['checkin-stats', eventId], (prev) => (prev ? { ...prev, checkedIn: res.stats.checkedIn, total: res.stats.total } : prev));
        present({ tone: toneOf(res.result), title: res.title, detail: res.detail, warning: res.warning, ticket: res.ticket, at: Date.now() });
      } catch (err) {
        if (err instanceof ApiError && err.code === 'network') present(await validateOffline(code, manual));
        else present({ tone: 'error', title: 'Kunne ikke sjekke billetten', detail: errorMessage(err), warning: null, ticket: null, at: Date.now() });
      } finally {
        busyRef.current = false;
        setProcessing(false);
      }
    },
    [api, eventId, gateName, present, qc],  
  );

  const paused = !!shown || processing || manualOpen || listOpen || settingsOpen;
  const cam = useQrCamera((c) => void handleCode(c), { enabled: allowed && !!eventId, paused });

  // Auto-advance after a green result so the line keeps moving; warnings and errors wait for a tap.
  useEffect(() => {
    if (!shown || shown.tone !== 'ok') return;
    const t = window.setTimeout(() => setShown((s) => (s && s.at === shown.at ? null : s)), shown.warning ? 3500 : 1700);
    return () => window.clearTimeout(t);
  }, [shown]);

  const undo = async () => {
    if (!shown?.ticket) return;
    setUndoing(true);
    try {
      const res = await api.post<ScanResult>('/checkin/manual', { eventId, ticketId: shown.ticket.id, undo: true });
      void stats.refetch();
      present({ tone: 'neutral', title: res.title, detail: res.ticket?.holderName ?? null, warning: null, ticket: null, at: Date.now() });
    } catch (err) {
      toast({ message: errorMessage(err), tone: 'error' });
    } finally {
      setUndoing(false);
    }
  };

  const demoScan = async (kind: 'valid' | 'used' | 'stale') => {
    unlockAudio();
    try {
      const res = await api.get<{ code: string }>(`/demo/sample-ticket/${eventId}?kind=${kind}`);
      lastRef.current = { code: '', at: 0 };
      await handleCode(res.code);
    } catch (err) {
      toast({ message: errorMessage(err), tone: 'error' });
    }
  };

  const logoutScanner = async () => {
    try {
      await api.post('/scanner/logout');
    } catch {
      /* ignore */
    }
    qc.clear();
    navigate('/skann', { replace: true });
  };

  const confirmLogout = async () => {
    const ok = await confirm({
      title: 'Logge ut av skanneren?',
      message: queue.length > 0 ? `${queue.length} innsjekk uten nett er ikke synkronisert ennå og går tapt.` : 'Du trenger skannerkoden for å logge inn igjen.',
      confirmLabel: 'Logg ut',
      destructive: true,
    });
    if (ok) await logoutScanner();
  };

  if (loading) return <CenterSpinner />;
  if (!allowed || (stats.isError && (stats.error.status === 401 || stats.error.status === 403 || stats.error.status === 404))) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center bg-black px-6 text-center text-white">
        <ShieldAlert className="h-14 w-14 text-white/80" aria-hidden="true" />
        <h1 className="mt-4 text-title2 font-bold">Ingen tilgang til denne skanneren</h1>
        <p className="mt-2 max-w-sm text-body text-white/75">Logg inn med skannerkoden du har fått, eller med en konto som er med i arrangørens team.</p>
        <Button className="mt-6" onClick={() => navigate('/skann', { replace: true })}>
          Til innlogging
        </Button>
      </div>
    );
  }

  const s = stats.data;
  const camFailed = cam.state === 'denied' || cam.state === 'unavailable' || cam.state === 'error';

  return (
    <div className="fixed inset-0 overflow-hidden bg-black text-white" onPointerDown={unlockAudio}>
      <main id="innhold" className="contents">
        <video ref={cam.videoRef} className={cn('absolute inset-0 h-full w-full object-cover', cam.state !== 'running' && 'opacity-0')} muted playsInline aria-hidden="true" />

        {!camFailed && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden="true">
            <div className="relative h-[min(68vw,300px)] w-[min(68vw,300px)] rounded-[28px] shadow-[0_0_0_200vmax_rgba(0,0,0,0.45)]">
              {['left-0 top-0 border-l-4 border-t-4 rounded-tl-[28px]', 'right-0 top-0 border-r-4 border-t-4 rounded-tr-[28px]', 'bottom-0 left-0 border-b-4 border-l-4 rounded-bl-[28px]', 'bottom-0 right-0 border-b-4 border-r-4 rounded-br-[28px]'].map((c) => (
                <span key={c} className={cn('absolute h-12 w-12 border-white', c)} />
              ))}
              {processing && (
                <span className="absolute inset-0 flex items-center justify-center">
                  <Spinner size={40} className="text-white" />
                </span>
              )}
            </div>
          </div>
        )}

        {cam.state === 'starting' && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Spinner size={32} className="text-white" label="Starter kameraet" />
          </div>
        )}

        {camFailed && (
          <div className="absolute inset-0 flex items-center justify-center px-6">
            <div className="w-full max-w-sm rounded-[26px] bg-white/10 p-6 text-center backdrop-blur">
              <h1 className="text-title3 font-bold">{cam.state === 'denied' ? 'Kameraet er ikke tillatt' : 'Kameraet er ikke tilgjengelig'}</h1>
              <p className="mt-2 text-subhead text-white/80">
                {cam.state === 'denied'
                  ? 'Gi TIKIT tilgang til kameraet i nettleserens innstillinger, og last inn siden på nytt. Til da kan du skrive billettnummeret eller bruke deltakerlisten.'
                  : 'Du kan fortsatt sjekke inn med billettnummer eller fra deltakerlisten.'}
              </p>
              <div className="mt-5 flex flex-col gap-2.5">
                <Button full onClick={() => setManualOpen(true)} icon={<Keyboard className="h-4 w-4" />}>
                  Skriv billettnummer
                </Button>
                <Button full variant="overlay" onClick={() => setListOpen(true)} icon={<Users className="h-4 w-4" />}>
                  Deltakerliste
                </Button>
              </div>
              {demo && (
                <div className="mt-5 rounded-[18px] bg-black/30 p-4 text-left">
                  <p className="flex items-center gap-2 text-subhead font-semibold text-[#ffb340]">
                    <FlaskConical className="h-4 w-4" aria-hidden="true" /> Demo: prøv skanneren uten kamera
                  </p>
                  <p className="mt-1 text-footnote text-white/80">Knappene sender en ekte kode fra demodataene gjennom den samme sjekken som kameraet bruker.</p>
                  <div className="mt-3 grid grid-cols-1 gap-2">
                    <button type="button" onClick={() => void demoScan('valid')} className={cn('press h-11 rounded-full px-4 text-subhead font-semibold', TONE_STYLE.ok)}>
                      Skann en gyldig billett
                    </button>
                    <button type="button" onClick={() => void demoScan('used')} className={cn('press h-11 rounded-full px-4 text-subhead font-semibold', TONE_STYLE.warn)}>
                      Skann en brukt billett
                    </button>
                    <button type="button" onClick={() => void demoScan('stale')} className={cn('press h-11 rounded-full px-4 text-subhead font-semibold', TONE_STYLE.error)}>
                      Skann et skjermbilde
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        <header className="absolute inset-x-0 top-0 z-20 flex items-center gap-2 px-3 pb-3" style={{ paddingTop: 'calc(var(--safe-top) + 8px)' }}>
          <button
            type="button"
            aria-label={scanner ? 'Logg ut av skanneren' : 'Tilbake'}
            onClick={() => (scanner ? void confirmLogout() : navigate(-1))}
            className="glass-clear press flex h-11 w-11 items-center justify-center rounded-full"
          >
            {scanner ? <LogOut className="h-5 w-5" /> : <ChevronLeft className="h-6 w-6" />}
          </button>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            aria-label={`${s?.title ?? scanner?.eventTitle ?? 'Skanner'}. ${gateName ? `Dør: ${gateName}` : 'Ingen dør valgt'}. Åpne skannerinnstillinger`}
            className="glass-clear press min-w-0 flex-1 rounded-full px-4 py-2 text-left"
          >
            <span className="block truncate text-subhead font-semibold">{s?.title ?? scanner?.eventTitle ?? 'Skanner'}</span>
            <span className="block truncate text-caption1 text-white/80">{gateName ? `Dør: ${gateName}` : 'Trykk her for å navngi døra'}</span>
          </button>
          <div className="glass-clear flex h-11 min-w-[88px] flex-col items-center justify-center rounded-full px-3" aria-label={s ? `${s.checkedIn} av ${s.total} sjekket inn` : undefined}>
            <span className="text-headline font-bold leading-none tabular">{s ? s.checkedIn : '–'}</span>
            <span className="text-[0.62rem] text-white/75 tabular">av {s ? s.total : '–'}</span>
          </div>
        </header>

        {(!online || queue.length > 0) && (
          <div className="absolute inset-x-0 top-[calc(var(--safe-top)+64px)] z-20 flex justify-center px-4">
            <p role="status" className={cn('flex items-center gap-2 rounded-full px-4 py-1.5 text-footnote font-semibold', TONE_STYLE.warn)}>
              <CloudOff className="h-4 w-4" aria-hidden="true" /> {online ? `Synkroniserer ${queue.length}` : `Uten nett${queue.length ? ` · ${queue.length} venter` : ''}`}
            </p>
          </div>
        )}

        {!camFailed && (
          <div className="absolute inset-x-0 bottom-0 z-20 flex flex-col items-center gap-3 px-4" style={{ paddingBottom: 'max(20px, var(--safe-bottom))' }}>
            <p className="rounded-full bg-black/40 px-3 py-1 text-footnote text-white/85">Hold QR-koden inne i rammen</p>
            {demo && (
              <div className="flex flex-wrap justify-center gap-2" role="group" aria-label="Demo-skanning">
                <button type="button" onClick={() => void demoScan('valid')} className="glass-clear press h-11 rounded-full px-3.5 text-footnote font-semibold">
                  Demo: gyldig
                </button>
                <button type="button" onClick={() => void demoScan('used')} className="glass-clear press h-11 rounded-full px-3.5 text-footnote font-semibold">
                  Demo: brukt
                </button>
                <button type="button" onClick={() => void demoScan('stale')} className="glass-clear press h-11 rounded-full px-3.5 text-footnote font-semibold">
                  Demo: skjermbilde
                </button>
              </div>
            )}
            <div className="glass-clear flex items-center gap-1 rounded-full p-1.5">
              <button type="button" onClick={() => setManualOpen(true)} className="press flex h-12 items-center gap-2 rounded-full px-4 text-subhead font-semibold">
                <Keyboard className="h-5 w-5" aria-hidden="true" /> Nummer
              </button>
              <button type="button" onClick={() => setListOpen(true)} className="press flex h-12 items-center gap-2 rounded-full px-4 text-subhead font-semibold">
                <Search className="h-5 w-5" aria-hidden="true" /> Liste
              </button>
              {cam.torch.available && (
                <button type="button" onClick={() => void cam.toggleTorch()} aria-pressed={cam.torch.on} aria-label={cam.torch.on ? 'Slå av lykten' : 'Slå på lykten'} className="press flex h-12 w-12 items-center justify-center rounded-full">
                  {cam.torch.on ? <FlashlightOff className="h-5 w-5" /> : <Flashlight className="h-5 w-5" />}
                </button>
              )}
              <button type="button" onClick={() => setSettingsOpen(true)} aria-label="Innstillinger" className="press flex h-12 w-12 items-center justify-center rounded-full">
                <Settings2 className="h-5 w-5" />
              </button>
            </div>
          </div>
        )}

        <AnimatePresence>
          {shown && (
            <ResultCard
              key={shown.at}
              shown={shown}
              onClose={() => setShown(null)}
              onUndo={shown.tone === 'ok' && shown.ticket && !shown.offline ? () => void undo() : undefined}
              undoing={undoing}
            />
          )}
        </AnimatePresence>
      </main>

      <Sheet open={manualOpen} onClose={() => setManualOpen(false)} title="Skriv billettnummer">
        <form
          className="flex flex-col gap-4 pb-2"
          onSubmit={(e) => {
            e.preventDefault();
            const v = manual.trim();
            if (!v) return;
            setManualOpen(false);
            setManual('');
            lastRef.current = { code: '', at: 0 };
            void handleCode(v, true);
          }}
        >
          <TextField
            label="Billettnummer eller kode"
            value={manual}
            onChange={(e) => setManual(e.target.value.toUpperCase())}
            placeholder="TK-7F3K9Q-01"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            hint="Står under QR-koden på billetten."
            data-autofocus
          />
          <Button type="submit" size="lg" full disabled={!manual.trim()}>
            Sjekk billetten
          </Button>
        </form>
      </Sheet>

      <AttendeesSheet
        open={listOpen}
        onClose={() => setListOpen(false)}
        eventId={eventId}
        onChanged={(res) => {
          void stats.refetch();
          setListOpen(false);
          present({ tone: toneOf(res.result), title: res.title, detail: res.detail, warning: res.warning, ticket: res.ticket, at: Date.now() });
        }}
      />

      <Sheet open={settingsOpen} onClose={() => setSettingsOpen(false)} title="Skanner">
        <div className="flex flex-col gap-4 pb-2">
          <TextField
            label="Navn på døra"
            value={gate}
            onChange={(e) => {
              setGate(e.target.value);
              safeStorage.set('tikit-gate', e.target.value);
            }}
            placeholder={scanner?.label ?? 'For eksempel Hovedinngang'}
            maxLength={40}
            hint="Vises i innsjekk-statistikken, så dere ser hvilken dør som er travlest."
          />
          <label className="flex items-center justify-between rounded-md bg-grouped-2 px-4 py-3">
            <span className="text-body">Lyd ved skanning</span>
            <input
              type="checkbox"
              checked={sound}
              onChange={(e) => {
                setSound(e.target.checked);
                safeStorage.set('tikit-scan-sound', e.target.checked ? 'on' : 'off');
                if (e.target.checked) unlockAudio();
              }}
              className="h-5 w-5 accent-[var(--tint-fill)]"
            />
          </label>
          {scanner ? (
            <Button variant="destructive" full icon={<LogOut className="h-4 w-4" />} onClick={() => void logoutScanner()}>
              Logg ut av skanneren
            </Button>
          ) : (
            <Button variant="gray" full onClick={() => navigate(-1)}>
              Lukk skanneren
            </Button>
          )}
        </div>
      </Sheet>
    </div>
  );
}
