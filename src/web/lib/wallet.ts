import type { ApiErrorBody } from '../../shared/errors';
import type { Api } from '../api/client';

type PassAdder = (pkpass: Uint8Array) => Promise<{ added: boolean }>;
let nativeAdder: PassAdder | null = null;

/** The iOS app adds passes with Apple's own sheet (src/web/native/device.ts). */
export function setNativeWalletAdder(fn: PassAdder): void {
  nativeAdder = fn;
}

/** True in the iOS app. In Safari, following the .pkpass link opens the same sheet. */
export function walletViaApp(): boolean {
  return nativeAdder !== null;
}

/** Fetches the ticket's .pkpass with the app's session token and shows «Legg til i Lommebok». */
export async function addAppleWalletPassInApp(api: Api, ticketId: string): Promise<{ added: boolean }> {
  if (!nativeAdder) throw new Error('Lommebok er ikke tilgjengelig her.');
  const res = await api.raw(`/tickets/${ticketId}/wallet/apple`);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new Error(body?.error?.message ?? 'Billettkortet kunne ikke hentes. Prøv igjen.');
  }
  return nativeAdder(new Uint8Array(await res.arrayBuffer()));
}
