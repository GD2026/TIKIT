import { useQuery, type UseQueryOptions } from '@tanstack/react-query';
import { useApi } from '../app/context';
import type { ApiError } from '../api/client';

export const adminKey = (...rest: unknown[]) => ['admin', ...rest] as const;

export function useAdminQuery<T>(path: string, opts: Omit<UseQueryOptions<T, ApiError>, 'queryKey' | 'queryFn'> = {}) {
  const api = useApi();
  return useQuery<T, ApiError>({ queryKey: adminKey(path), queryFn: () => api.get(`/admin${path}`), ...opts });
}
