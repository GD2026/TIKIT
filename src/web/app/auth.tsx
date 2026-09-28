import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Check, FlaskConical, Lock } from 'lucide-react';
import type { ProviderId } from '../../shared/types';
import { useApi } from './context';
import { useConfig, useMe } from '../api/hooks';
import { errorMessage } from '../api/client';
import { Sheet } from '../components/ui/Sheet';
import { AppleButton, GoogleButton, Logo, VippsButton } from '../components/brand/Brand';
import { Button } from '../components/ui/Button';
import { useToast } from '../components/ui/Overlays';
import { Avatar } from '../components/ui/Avatar';
import { cn } from '../lib/cn';

export async function clearOfflineTicketCache(): Promise<void> {
  try {
    if ('caches' in window) await caches.delete('tikit-tickets');
  } catch {
    /* ignore */
  }
}

interface LoginRequest {
  returnTo?: string;
  mode?: 'login' | 'link';
  reason?: string;
  /** Continues the action that needed sign-in (in-app sign-in only; a full redirect reloads the page). */
  then?: () => void;
}

interface AuthApi {
  openLogin(req?: LoginRequest): void;
  startProvider(provider: ProviderId, req?: LoginRequest): void;
  logout(): Promise<void>;
}

const AuthContext = createContext<AuthApi | null>(null);

export function useAuthActions(): AuthApi {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('AuthProvider mangler');
  return ctx;
}

/** Current user + helpers. */
export function useAuth() {
  const q = useMe();
  const actions = useAuthActions();
  return {
    me: q.data?.me ?? null,
    scanner: q.data?.scanner ?? null,
    loading: q.isLoading,
    ...actions,
  };
}

/** Runs `fn` when signed in; otherwise asks the person to sign in first and brings them back here. */
export function useLoginGate() {
  const { me, openLogin } = useAuth();
  const location = useLocation();
  return (reason: string, fn: () => void) => {
    if (!me) {
      openLogin({ reason, returnTo: `${location.pathname}${location.search}`, then: fn });
      return;
    }
    fn();
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const api = useApi();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const config = useConfig().data;
  const [loginReq, setLoginReq] = useState<LoginRequest | null>(null);
  const [demoProvider, setDemoProvider] = useState<{ provider: ProviderId; req: LoginRequest } | null>(null);

  // Following a link (terms, privacy) or going back closes the login sheet instead of leaving it on top.
  const { pathname } = useLocation();
  useEffect(() => {
    setLoginReq(null);
  }, [pathname]);

  const startProvider = useCallback(
    (provider: ProviderId, req: LoginRequest = {}) => {
      const p = config?.providers.find((x) => x.id === provider);
      if (!p) {
        toast({ message: 'Denne innloggingen er ikke tilgjengelig akkurat nå.', tone: 'error' });
        return;
      }
      if (p.demo) {
        setLoginReq(null);
        setDemoProvider({ provider, req });
        return;
      }
      const returnTo = req.returnTo ?? `${window.location.pathname}${window.location.search}`;
      const qs = new URLSearchParams({ returnTo, ...(req.mode === 'link' ? { mode: 'link' } : {}) });
      window.location.assign(`/api/auth/login/${provider}?${qs.toString()}`);
    },
    [config, toast],
  );

  const value = useMemo<AuthApi>(
    () => ({
      openLogin: (req = {}) => setLoginReq(req),
      startProvider,
      async logout() {
        try {
          await api.post('/auth/logout');
        } catch {
          /* ignore */
        }
        await clearOfflineTicketCache();
        qc.clear();
        navigate('/');
        toast({ message: 'Du er logget ut', tone: 'info' });
      },
    }),
    [api, qc, navigate, toast, startProvider],
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
      <Sheet open={!!loginReq} onClose={() => setLoginReq(null)} title="Logg inn" ariaLabel="Logg inn">
        <LoginPanel reason={loginReq?.reason} onProvider={(p) => startProvider(p, loginReq ?? {})} />
      </Sheet>
      <DemoProviderSheet
        state={demoProvider}
        onClose={() => setDemoProvider(null)}
        onDone={async (req) => {
          setDemoProvider(null);
          await qc.invalidateQueries();
          if (req.mode === 'link') toast({ message: 'Innloggingsmetoden er koblet til', tone: 'success' });
          else toast({ message: 'Du er logget inn', tone: 'success' });
          if (req.returnTo && req.returnTo !== `${window.location.pathname}${window.location.search}`) navigate(req.returnTo, { replace: true });
          if (req.then) window.setTimeout(req.then, 60);
        }}
      />
    </AuthContext.Provider>
  );
}

export function LoginPanel({ reason, onProvider, compact }: { reason?: string | undefined; onProvider: (p: ProviderId) => void; compact?: boolean }) {
  const config = useConfig().data;
  const ids = config?.providers.map((p) => p.id) ?? ['vipps', 'apple', 'google'];
  const order: ProviderId[] = ['vipps', 'apple', 'google'];
  return (
    <div className={cn('flex flex-col items-center text-center', compact ? 'py-2' : 'py-4')}>
      {!compact && <Logo className="mb-4" size={40} />}
      <h2 className="text-title2 font-bold">{reason ?? 'Logg inn for å kjøpe og se billettene dine'}</h2>
      <p className="mt-2 max-w-sm text-subhead text-label-2">Ingen passord. Vi bruker Vipps, Apple eller Google – med Vipps bekrefter vi også alderen din automatisk.</p>
      <div className="mt-6 flex w-full max-w-sm flex-col gap-3">
        {order
          .filter((p) => ids.includes(p))
          .map((p) =>
            p === 'vipps' ? (
              <VippsButton key={p} onClick={() => onProvider('vipps')} />
            ) : p === 'apple' ? (
              <AppleButton key={p} onClick={() => onProvider('apple')} />
            ) : (
              <GoogleButton key={p} onClick={() => onProvider('google')} />
            ),
          )}
      </div>
      <p className="mt-5 max-w-sm text-footnote text-label-2">
        Ved å fortsette godtar du{' '}
        <a href={import.meta.env.MODE === 'demo' ? '#/vilkar' : '/vilkar'} className="text-tint underline underline-offset-2">
          vilkårene
        </a>{' '}
        og{' '}
        <a href={import.meta.env.MODE === 'demo' ? '#/personvernerklaering' : '/personvernerklaering'} className="text-tint underline underline-offset-2">
          personvernerklæringen
        </a>
        .
      </p>
    </div>
  );
}

// ── Simulated provider screens (demo mode only) ───────────────────────────────

function DemoProviderSheet({
  state,
  onClose,
  onDone,
}: {
  state: { provider: ProviderId; req: LoginRequest } | null;
  onClose: () => void;
  onDone: (req: LoginRequest) => Promise<void>;
}) {
  const api = useApi();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [persona, setPersona] = useState<'buyer' | 'new'>('buyer');
  const provider = state?.provider ?? 'vipps';

  const confirm = async () => {
    if (!state) return;
    setBusy(true);
    try {
      await api.post(`/auth/demo${state.req.mode === 'link' ? '?mode=link' : ''}`, { provider: state.provider, persona, ...(persona === 'new' ? { name: 'Ny Bruker' } : {}) });
      await onDone(state.req);
    } catch (err) {
      toast({ message: errorMessage(err), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const personaPicker = state?.req.mode !== 'link' && (
    <div className="flex flex-col gap-2 text-left" role="group" aria-label="Velg testperson">
      {(
        [
          { id: 'buyer', name: 'Emma Hansen', detail: provider === 'vipps' ? '912 34 567' : 'emma.hansen@example.no' },
          { id: 'new', name: 'Ny bruker', detail: 'Start med en tom konto' },
        ] as const
      ).map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => setPersona(p.id)}
          aria-pressed={persona === p.id}
          className={cn('flex items-center gap-3 rounded-[14px] p-3 text-left transition-colors', persona === p.id ? 'bg-tint-soft shadow-[inset_0_0_0_2px_var(--tint)]' : 'bg-fill-4')}
        >
          <Avatar name={p.name} size={36} />
          <span className="min-w-0 flex-1">
            <span className="block text-subhead font-semibold">{p.name}</span>
            <span className="block text-footnote text-label-2">{p.detail}</span>
          </span>
          {persona === p.id && <Check className="h-5 w-5 text-tint" />}
        </button>
      ))}
    </div>
  );

  const providerName = provider === 'vipps' ? 'Vipps' : provider === 'apple' ? 'Apple' : 'Google';
  const shares =
    provider === 'vipps'
      ? 'navn, mobilnummer, e-post og bekreftet fødselsdato (brukes til aldersgrenser)'
      : provider === 'apple'
        ? 'navn og e-post (du kan velge å skjule e-postadressen)'
        : 'navn og e-post';

  return (
    <Sheet open={!!state} onClose={onClose} locked={busy} title="Demo-innlogging">
      <div className="mb-4 flex items-start gap-2 rounded-[12px] bg-orange-soft px-3 py-2.5 text-footnote font-medium text-orange">
        <FlaskConical className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>
          I den ekte appen åpnes {providerName} her, og du bekrefter der. TIKIT får da {shares}. I demoen velger du bare en testperson – ingen ekte konto brukes.
        </span>
      </div>
      {state?.req.mode === 'link' ? (
        <p className="px-1 text-body">Koble {providerName} til kontoen din, så kan du logge inn med begge.</p>
      ) : (
        personaPicker
      )}
      <Button full size="lg" className="mt-5" loading={busy} onClick={() => void confirm()} icon={<Lock className="h-4 w-4" />}>
        {state?.req.mode === 'link' ? `Koble til ${providerName}` : `Fortsett med ${providerName} (demo)`}
      </Button>
    </Sheet>
  );
}
