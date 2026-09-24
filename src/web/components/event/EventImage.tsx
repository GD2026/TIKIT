import { useEffect, useState } from 'react';
import type { PosterSpec } from '../../../shared/types';
import { useApi } from '../../app/context';
import { cn } from '../../lib/cn';
import { PosterArt } from './PosterArt';

/** Resolves `/api/images/…` through the active transport (the demo serves images from memory). */
export function useResolvedUrl(url: string | null): string | null {
  const api = useApi();
  const direct = !url || !api.transport.resolveUrl || !url.startsWith('/api/');
  const [resolved, setResolved] = useState<string | null>(direct ? url : null);
  useEffect(() => {
    if (direct) {
      setResolved(url);
      return;
    }
    let alive = true;
    void api.transport.resolveUrl!(url!).then((u) => {
      if (alive) setResolved(u || null);
    });
    return () => {
      alive = false;
    };
  }, [url, direct, api]);
  return resolved;
}

export function ApiImage({ src, alt, className, loading = 'lazy' }: { src: string | null; alt: string; className?: string; loading?: 'lazy' | 'eager' }) {
  const url = useResolvedUrl(src);
  if (!url) return <div className={cn('bg-fill-3', className)} aria-hidden={alt ? undefined : true} />;
  return <img src={url} alt={alt} loading={loading} decoding="async" className={cn('object-cover', className)} />;
}

export function EventImage({
  poster,
  coverUrl,
  className,
  eager,
}: {
  poster: PosterSpec;
  coverUrl: string | null;
  /** The event title is always shown as text next to the image, so the poster is decorative for screen readers. */
  title: string;
  className?: string;
  eager?: boolean;
}) {
  // Callers often position the image themselves (absolute inset-0); only add `relative` when they don't.
  const positioned = /(^|\s)(absolute|fixed|relative|sticky)(\s|$)/.test(className ?? '');
  return (
    <div className={cn(!positioned && 'relative', 'overflow-hidden bg-fill-3', className)}>
      {coverUrl ? (
        <ApiImage src={coverUrl} alt="" className="absolute inset-0 h-full w-full" loading={eager ? 'eager' : 'lazy'} />
      ) : (
        <PosterArt poster={poster} className="absolute inset-0 h-full w-full" />
      )}
    </div>
  );
}
