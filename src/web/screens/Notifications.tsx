import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Ban, Bell, CalendarClock, CircleCheck, Gift, Hourglass, Megaphone, PencilLine, Repeat2, Send, Ticket, Undo2, Users } from 'lucide-react';
import type { AppNotification, NotificationKind } from '../../shared/types';
import { formatAgo } from '../../shared/time';
import { useApi } from '../app/context';
import { qk, useNotifications } from '../api/hooks';
import { Page } from '../components/layout/Page';
import { EmptyState } from '../components/ui/Feedback';
import { IconTile } from '../components/ui/List';
import { ListSkeleton, QueryError, RequireLogin } from '../components/ui/States';
import { cn } from '../lib/cn';

const KIND: Record<NotificationKind, { icon: React.ReactNode; color: string }> = {
  order_confirmed: { icon: <Ticket />, color: '#34C759' },
  transfer_received: { icon: <Gift />, color: '#3B4CF2' },
  transfer_accepted: { icon: <Send />, color: '#3B4CF2' },
  resale_sold: { icon: <Repeat2 />, color: '#12B886' },
  resale_bought: { icon: <Repeat2 />, color: '#12B886' },
  waitlist_available: { icon: <Hourglass />, color: '#FF9500' },
  sale_started: { icon: <Megaphone />, color: '#FF5E3A' },
  event_reminder: { icon: <CalendarClock />, color: '#5856D6' },
  event_cancelled: { icon: <Ban />, color: '#FF3B30' },
  event_changed: { icon: <PencilLine />, color: '#FF9500' },
  refund_issued: { icon: <Undo2 />, color: '#8E8E93' },
  organizer_status: { icon: <CircleCheck />, color: '#34C759' },
  team_invite: { icon: <Users />, color: '#30B0C7' },
  guest_ticket: { icon: <Gift />, color: '#FF2D55' },
};

function List() {
  const api = useApi();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const q = useNotifications();
  const items = q.data?.notifications ?? [];
  const unread = items.filter((n) => !n.readAt).length;

  // Mark everything as read shortly after the list has been seen.
  useEffect(() => {
    if (unread === 0) return;
    const t = window.setTimeout(() => {
      void api.post('/me/notifications/read', { ids: null }).then(() => {
        void qc.invalidateQueries({ queryKey: qk.me });
      });
    }, 1500);
    return () => window.clearTimeout(t);
  }, [unread, api, qc]);

  if (q.isLoading) return <ListSkeleton rows={5} />;
  if (q.isError) return <QueryError error={q.error} onRetry={() => void q.refetch()} />;
  if (items.length === 0) return <EmptyState icon={<Bell />} title="Ingen varsler" message="Her får du beskjed om billetter, overføringer, billettslipp og endringer." />;

  const open = (n: AppNotification) => {
    if (n.link && n.link.startsWith('/')) navigate(n.link);
  };

  return (
    <ul className="mx-4 overflow-hidden rounded-md bg-grouped-2 [&>*+*]:hairline-t">
      {items.map((n) => {
        const k = KIND[n.kind] ?? { icon: <Bell />, color: '#8E8E93' };
        const inner = (
          <>
            <IconTile color={k.color} className="mt-0.5">
              {k.icon}
            </IconTile>
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-3">
                <span className={cn('text-body', !n.readAt && 'font-semibold')}>{n.title}</span>
                <span className="shrink-0 text-footnote text-label-2">{formatAgo(n.createdAt)}</span>
              </span>
              <span className="mt-0.5 block text-subhead text-label-2">{n.body}</span>
            </span>
            {!n.readAt && (
              <>
                <span className="mt-2 h-2.5 w-2.5 shrink-0 rounded-full bg-tint-fill" aria-hidden="true" />
                <span className="sr-only">Ulest</span>
              </>
            )}
          </>
        );
        return (
          <li key={n.id}>
            {n.link ? (
              <button type="button" onClick={() => open(n)} className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-fill-4">
                {inner}
              </button>
            ) : (
              <div className="flex w-full items-start gap-3 px-4 py-3">{inner}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export default function Notifications() {
  return (
    <Page
      title="Varsler"
      back="/profil"
      actions={
        <Link to="/profil/varsler" className="press inline-flex h-11 items-center rounded-full px-3 text-body font-medium text-tint no-underline hover:bg-fill-4">
          Innstillinger
        </Link>
      }
    >
      <RequireLogin>
        <List />
      </RequireLogin>
    </Page>
  );
}
