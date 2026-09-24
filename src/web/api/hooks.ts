import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import type {
  AppConfig,
  AppNotification,
  EventCard,
  EventDetail,
  Me,
  OrderDTO,
  QueueStatus,
  ScannerMe,
  TicketDTO,
} from '../../shared/types';
import { useApi } from '../app/context';
import { type ApiError } from './client';
import { safeStorage } from '../lib/storage';

export const qk = {
  config: ['config'] as const,
  me: ['me'] as const,
  home: (city: string | null) => ['home', city] as const,
  events: (params: Record<string, string | undefined>) => ['events', params] as const,
  event: (slug: string, unlock: string | null) => ['event', slug, unlock] as const,
  seatMap: (eventId: string, orderId: string | null) => ['seatmap', eventId, orderId] as const,
  resale: (eventId: string) => ['resale', eventId] as const,
  order: (id: string) => ['order', id] as const,
  tickets: ['tickets'] as const,
  ticket: (id: string) => ['ticket', id] as const,
  notifications: ['notifications'] as const,
  favorites: ['favorites'] as const,
  myOrders: ['myOrders'] as const,
  transfer: (token: string) => ['transfer', token] as const,
  queue: (eventId: string) => ['queue', eventId] as const,
  organizer: (slug: string) => ['organizer', slug] as const,
};

type QOpts<T> = Omit<UseQueryOptions<T, ApiError>, 'queryKey' | 'queryFn'>;

export function useConfig() {
  const api = useApi();
  return useQuery<AppConfig, ApiError>({ queryKey: qk.config, queryFn: () => api.get('/config'), staleTime: 5 * 60_000 });
}

export interface MeResponse {
  me: Me | null;
  scanner: ScannerMe | null;
}

export function useMe() {
  const api = useApi();
  return useQuery<MeResponse, ApiError>({ queryKey: qk.me, queryFn: () => api.get('/me'), staleTime: 30_000 });
}

export interface HomeSection {
  id: string;
  title: string;
  subtitle?: string;
  style: 'hero' | 'row' | 'countdown' | 'list';
  events: EventCard[];
}

export function useHome(city: string | null) {
  const api = useApi();
  return useQuery<{ sections: HomeSection[]; city: string | null }, ApiError>({
    queryKey: qk.home(city),
    queryFn: () => api.get(`/home?city=${encodeURIComponent(city ?? '')}`),
    staleTime: 30_000,
  });
}

export function useEvents(params: Record<string, string | undefined>, enabled = true) {
  const api = useApi();
  const qs = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1])).toString();
  return useQuery<{ events: EventCard[] }, ApiError>({
    queryKey: qk.events(params),
    queryFn: () => api.get(`/events${qs ? `?${qs}` : ''}`),
    enabled,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
}

// ── Access-code unlock tokens (kept for the browser session) ───────────────
const UNLOCK_KEY = 'tikit-unlock';
export function getUnlockToken(eventId: string): string | null {
  return safeStorage.getJSON<Record<string, string>>(UNLOCK_KEY, {})[eventId] ?? null;
}
export function setUnlockToken(eventId: string, token: string): void {
  const all = safeStorage.getJSON<Record<string, string>>(UNLOCK_KEY, {});
  all[eventId] = token;
  safeStorage.setJSON(UNLOCK_KEY, all);
}

export function useEvent(slug: string | undefined, eventIdForUnlock: string | null, opts: QOpts<EventDetail> = {}) {
  const api = useApi();
  const unlock = eventIdForUnlock ? getUnlockToken(eventIdForUnlock) : null;
  return useQuery<EventDetail, ApiError>({
    queryKey: qk.event(slug ?? '', unlock),
    queryFn: () => api.get(`/events/${encodeURIComponent(slug!)}`, unlock ? { 'X-Tikit-Unlock': unlock } : {}),
    enabled: !!slug,
    staleTime: 10_000,
    ...opts,
  });
}

export function useOrder(id: string | undefined, opts: QOpts<OrderDTO> = {}) {
  const api = useApi();
  return useQuery<OrderDTO, ApiError>({ queryKey: qk.order(id ?? ''), queryFn: () => api.get(`/orders/${id}`), enabled: !!id, ...opts });
}

/**
 * The signed-in user's id rides along on ticket URLs (the server ignores it). The service worker caches
 * tickets per URL for offline use at the door, so this keeps one person's tickets from ever being served
 * to someone else who signs in on the same phone.
 */
function useTicketOwner(): string {
  return useMe().data?.me?.id ?? '';
}

export function useTickets(enabled = true) {
  const api = useApi();
  const owner = useTicketOwner();
  return useQuery<{ tickets: TicketDTO[]; serverTime: string }, ApiError>({
    queryKey: qk.tickets,
    queryFn: () => api.get(`/tickets?u=${encodeURIComponent(owner)}`),
    enabled: enabled && !!owner,
    staleTime: 15_000,
  });
}

export function useTicket(id: string | undefined) {
  const api = useApi();
  const owner = useTicketOwner();
  return useQuery<{ ticket: TicketDTO; serverTime: string }, ApiError>({
    queryKey: qk.ticket(id ?? ''),
    queryFn: () => api.get(`/tickets/${id}?u=${encodeURIComponent(owner)}`),
    enabled: !!id && !!owner,
    staleTime: 15_000,
  });
}

export function useNotifications(enabled = true) {
  const api = useApi();
  return useQuery<{ notifications: AppNotification[] }, ApiError>({ queryKey: qk.notifications, queryFn: () => api.get('/me/notifications'), enabled });
}

export function useFavorites(enabled = true) {
  const api = useApi();
  return useQuery<{ events: EventCard[] }, ApiError>({ queryKey: qk.favorites, queryFn: () => api.get('/me/favorites'), enabled });
}

export function useMyOrders(enabled = true) {
  const api = useApi();
  return useQuery<{ orders: OrderDTO[] }, ApiError>({ queryKey: qk.myOrders, queryFn: () => api.get('/me/orders'), enabled });
}

export function useQueueStatus(eventId: string | null, enabled: boolean) {
  const api = useApi();
  return useQuery<{ status: QueueStatus | null }, ApiError>({
    queryKey: qk.queue(eventId ?? ''),
    queryFn: () => api.get(`/events/${eventId}/queue`),
    enabled: enabled && !!eventId,
    refetchInterval: (q) => {
      const s = q.state.data?.status?.status;
      if (s === 'admitted' || s === 'expired' || s === 'sold_out') return false;
      return 3000;
    },
  });
}

/** Invalidates everything that depends on who is logged in. */
export function useInvalidateSession() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries();
}

export function useSimpleMutation<TVars, TResult>(fn: (vars: TVars) => Promise<TResult>, invalidate: readonly (readonly unknown[])[] = []) {
  const qc = useQueryClient();
  return useMutation<TResult, ApiError, TVars>({
    mutationFn: fn,
    onSuccess: async () => {
      await Promise.all(invalidate.map((key) => qc.invalidateQueries({ queryKey: key as unknown[] })));
    },
  });
}
