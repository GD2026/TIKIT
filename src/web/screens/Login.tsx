import { Link, Navigate, useSearchParams } from 'react-router';
import { CircleAlert, ScanLine } from 'lucide-react';
import { ERROR_MESSAGES, type ErrorCode } from '../../shared/errors';
import { LoginPanel, useAuth } from '../app/auth';
import { BackButton } from '../components/layout/Page';
import { CenterSpinner } from '../components/ui/States';
import { useDocumentTitle } from '../lib/hooks';
import { safeReturnPath } from '../../shared/redirect';

export default function Login() {
  const [params] = useSearchParams();
  const { me, loading, startProvider } = useAuth();
  useDocumentTitle('Logg inn');
  const returnTo = safeReturnPath(params.get('returnTo'));
  const errCode = params.get('feil');
  const error = errCode ? (ERROR_MESSAGES[errCode as ErrorCode] ?? ERROR_MESSAGES.login_failed) : null;

  if (loading) return <CenterSpinner />;
  if (me) return <Navigate to={returnTo === '/' ? '/profil' : returnTo} replace />;

  return (
    <div className="flex min-h-dvh flex-col bg-grouped px-4 pb-[max(24px,var(--safe-bottom))]" style={{ paddingTop: 'calc(var(--safe-top) + 8px)' }}>
      <div className="flex h-[52px] items-center">
        <BackButton fallback="/" />
      </div>
      <main id="innhold" className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center">
        <h1 className="sr-only">Logg inn på TIKIT</h1>
        {error && (
          <div role="alert" className="mb-6 flex items-start gap-3 rounded-md bg-red-soft px-4 py-3">
            <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-red" aria-hidden="true" />
            <p className="text-subhead">{error}</p>
          </div>
        )}
        <div className="rounded-[26px] bg-grouped-2 px-5 py-6 shadow-[var(--card-shadow)]">
          <LoginPanel onProvider={(p) => startProvider(p, { returnTo })} />
        </div>
        <Link to="/skann" className="mx-auto mt-6 inline-flex h-11 items-center gap-2 text-subhead font-medium text-tint no-underline">
          <ScanLine className="h-4 w-4" aria-hidden="true" /> Dørvakt? Logg inn på billettskanneren
        </Link>
      </main>
    </div>
  );
}
