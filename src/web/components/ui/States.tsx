import type { ReactNode } from 'react';
import { useLocation } from 'react-router';
import { LogIn } from 'lucide-react';
import { ApiError, errorMessage } from '../../api/client';
import { useAuth } from '../../app/auth';
import { Button } from './Button';
import { EmptyState, ErrorState, Skeleton, Spinner } from './Feedback';
import { cn } from '../../lib/cn';

export function CenterSpinner({ className, label }: { className?: string; label?: string }) {
  return (
    <div className={cn('flex min-h-[50dvh] items-center justify-center', className)}>
      <Spinner size={28} label={label} />
    </div>
  );
}

export function ListSkeleton({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('mx-4 overflow-hidden rounded-md bg-grouped-2', className)} aria-busy="true" aria-label="Laster">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3 [&+&]:hairline-t">
          <Skeleton className="h-[60px] w-[50px] shrink-0 rounded-[10px]" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-3/5" />
            <Skeleton className="h-3.5 w-2/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Standard rendering of a failed query: "not found" gets its own wording. */
export function QueryError({ error, onRetry, notFound }: { error: unknown; onRetry?: () => void; notFound?: ReactNode }) {
  if (error instanceof ApiError && error.status === 404 && notFound) return <>{notFound}</>;
  const retry = error instanceof ApiError && (error.status === 0 || error.status >= 500 || error.code === 'rate_limited') ? onRetry : undefined;
  return <ErrorState message={errorMessage(error)} onRetry={retry ?? onRetry} />;
}

/**
 * Wraps screens that need a signed-in person. Shows the sign-in options in place instead of
 * bouncing people to another page, so they keep their context.
 */
export function RequireLogin({ children, reason, icon }: { children: ReactNode; reason?: string; icon?: ReactNode }) {
  const { me, loading, openLogin } = useAuth();
  const location = useLocation();
  if (loading) return <CenterSpinner />;
  if (!me)
    return (
      <EmptyState
        icon={icon ?? <LogIn />}
        title="Logg inn for å fortsette"
        message={reason ?? 'Du må være logget inn for å se dette.'}
        action={
          <Button size="lg" onClick={() => openLogin({ returnTo: `${location.pathname}${location.search}` })}>
            Logg inn
          </Button>
        }
      />
    );
  return <>{children}</>;
}
