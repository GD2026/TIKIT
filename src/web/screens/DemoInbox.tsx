import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, Inbox } from 'lucide-react';
import type { OutboxEmail } from '../../shared/types';
import { formatAgo } from '../../shared/time';
import { useApi } from '../app/context';
import { type ApiError } from '../api/client';
import { Page } from '../components/layout/Page';
import { Sheet } from '../components/ui/Sheet';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/Feedback';
import { ListSkeleton, QueryError, RequireLogin } from '../components/ui/States';
import { followUrl } from '../lib/links';

function extractLinks(html: string): { href: string; label: string }[] {
  const out: { href: string; label: string }[] = [];
  const re = /<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const href = m[1]!.replace(/&amp;/g, '&');
    const label = m[2]!.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (/^https?:\/\//.test(href) && label && !out.some((l) => l.href === href)) out.push({ href, label });
  }
  return out;
}

function Mailbox() {
  const api = useApi();
  const navigate = useNavigate();
  const [open, setOpen] = useState<OutboxEmail | null>(null);
  const q = useQuery<{ emails: OutboxEmail[] }, ApiError>({ queryKey: ['outbox'], queryFn: () => api.get('/demo/outbox'), refetchInterval: 5000 });
  const links = useMemo(() => (open ? extractLinks(open.html) : []), [open]);

  if (q.isLoading) return <ListSkeleton rows={4} />;
  if (q.isError) return <QueryError error={q.error} onRetry={() => void q.refetch()} />;
  const emails = q.data?.emails ?? [];
  if (emails.length === 0) return <EmptyState icon={<Inbox />} title="Ingen e-post ennå" message="Kvitteringer, overføringer og varsler som TIKIT sender, dukker opp her i demoen." />;

  return (
    <>
      <p className="mx-6 mb-3 text-footnote text-label-2">I demoen sendes ingen ekte e-post. Her ser du det TIKIT ville ha sendt til kontoen du er logget inn med.</p>
      <div className="mx-4 overflow-hidden rounded-md bg-grouped-2 [&>*+*]:hairline-t">
        {emails.map((m) => (
          <button key={m.id} type="button" onClick={() => setOpen(m)} className="flex w-full flex-col items-start px-4 py-3 text-left transition-colors hover:bg-fill-4">
            <span className="flex w-full items-baseline justify-between gap-3">
              <span className="truncate text-headline font-semibold">{m.subject}</span>
              <span className="shrink-0 text-footnote text-label-2">{formatAgo(m.createdAt)}</span>
            </span>
            <span className="mt-0.5 line-clamp-2 text-subhead text-label-2">{m.text.slice(0, 180)}</span>
            <span className="mt-1 text-footnote text-label-3">Til: {m.to}</span>
          </button>
        ))}
      </div>
      <Sheet open={!!open} onClose={() => setOpen(null)} title={open?.subject} size="large">
        {open && (
          <div className="flex flex-col gap-3">
            <iframe title={open.subject} sandbox="" srcDoc={open.html} className="h-[56vh] w-full rounded-[14px] border-0 bg-white" />
            {links.map((l) => (
              <Button
                key={l.href}
                variant="tinted"
                full
                trailing={<ArrowUpRight className="h-4 w-4" />}
                onClick={() => {
                  setOpen(null);
                  followUrl(l.href, navigate);
                }}
              >
                {l.label}
              </Button>
            ))}
          </div>
        )}
      </Sheet>
    </>
  );
}

export default function DemoInbox() {
  return (
    <Page title="Innboks (demo)" back="/profil">
      <RequireLogin>
        <Mailbox />
      </RequireLogin>
    </Page>
  );
}
