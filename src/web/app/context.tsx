import { createContext, useContext } from 'react';
import type { Api } from '../api/client';

export const ApiContext = createContext<Api | null>(null);

export function useApi(): Api {
  const api = useContext(ApiContext);
  if (!api) throw new Error('ApiContext mangler');
  return api;
}

export interface DemoControls {
  reset(): Promise<void>;
  seededAt: string;
}

export const DemoContext = createContext<DemoControls | null>(null);

export function useDemo(): DemoControls | null {
  return useContext(DemoContext);
}
