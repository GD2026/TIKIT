import type { ReactNode } from 'react';
import { useOutletContext } from 'react-router';
import { useQuery, type UseQueryOptions } from '@tanstack/react-query';
import type { EventStatus, SaleState } from '../../shared/types';
import type { OrgDetail } from '../../server/services/organizers';
import { formatDateLong } from '../../shared/time';
import { useApi } from '../app/context';
import type { ApiError } from '../api/client';
import type { PillTone } from '../components/ui/Feedback';

export interface OrgContext {
  org: OrgDetail;
  refetch: () => void;
}

export function useOrg(): OrgContext {
  return useOutletContext<OrgContext>();
}

export const orgKey = (orgId: string, ...rest: unknown[]) => ['org', orgId, ...rest] as const;

/** GET an organizer endpoint under /org/:orgId. */
export function useOrgQuery<T>(orgId: string, path: string, opts: Omit<UseQueryOptions<T, ApiError>, 'queryKey' | 'queryFn'> = {}) {
  const api = useApi();
  return useQuery<T, ApiError>({ queryKey: orgKey(orgId, path), queryFn: () => api.get(`/org/${orgId}${path}`), ...opts });
}

export function canManage(role: OrgDetail['role']): boolean {
  return role === 'owner' || role === 'admin';
}

export function eventStatusPill(status: EventStatus, saleState: SaleState): { label: string; tone: PillTone } {
  if (status === 'draft') return { label: 'Utkast', tone: 'orange' };
  if (status === 'cancelled') return { label: 'Avlyst', tone: 'red' };
  switch (saleState) {
    case 'past':
      return { label: 'Ferdig', tone: 'neutral' };
    case 'sold_out':
      return { label: 'Utsolgt', tone: 'tint' };
    case 'upcoming':
      return { label: 'Salg ikke startet', tone: 'neutral' };
    case 'ended':
      return { label: 'Salget er over', tone: 'neutral' };
    default:
      return { label: 'I salg', tone: 'green' };
  }
}

const MONTHS_SHORT = ['jan', 'feb', 'mar', 'apr', 'mai', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'des'];

/** "2026-10-03" → { short: "3. okt", full: "lørdag 3. oktober 2026" } */
export function dayLabels(key: string): { short: string; full: string } {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  const noon = new Date(Date.UTC(y, m - 1, d, 12));
  return { short: `${d}. ${MONTHS_SHORT[m - 1]}`, full: formatDateLong(noon) };
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-lg bg-grouped-2 p-4 ${className ?? ''}`}>{children}</div>;
}
