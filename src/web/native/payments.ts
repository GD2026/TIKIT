import { App } from '@capacitor/app';
import { AppLauncher } from '@capacitor/app-launcher';
import { Browser } from '@capacitor/browser';
import type { PluginListenerHandle } from '@capacitor/core';
import type { OrderDTO } from '../../shared/types';
import type { Api } from '../api/client';

/**
 * Paying from the iOS app.
 *
 *  - Vipps: the payment page is opened by iOS, which starts the Vipps app directly (universal link) or
 *    Safari when Vipps isn't installed. Afterwards Vipps sends the buyer to https://…/app/ordre/<id>, a
 *    universal link that brings them back into TIKIT (deepLinks.ts). We also check when the app returns.
 *  - Card (Stripe Checkout): opened in an in-app Safari sheet. While it is open the order is checked every
 *    few seconds; when it is paid the sheet closes by itself.
 *
 * Tickets are physical-world services, so external payment is what App Store Guideline 3.1.3(e) requires.
 */

let stop: (() => void) | null = null;

export async function openPayment(api: Api, orderId: string, url: string, on: { paid: () => void; stopped?: () => void }): Promise<void> {
  stop?.();
  const handles: PluginListenerHandle[] = [];
  let finished = false;

  const finish = (paid: boolean) => {
    if (finished) return;
    finished = true;
    window.clearInterval(timer);
    for (const h of handles) void h.remove();
    stop = null;
    if (paid) {
      void Browser.close().catch(() => {});
      on.paid();
    } else {
      on.stopped?.();
    }
  };
  stop = () => finish(false);

  const check = async () => {
    try {
      const order = await api.post<OrderDTO>(`/orders/${orderId}/sync`);
      if (order.status === 'paid') finish(true);
      else if (order.status !== 'pending_payment') finish(false);
    } catch {
      /* offline for a moment – try again on the next tick */
    }
  };

  const timer = window.setInterval(() => void check(), 3000);
  const card = /(^|\.)stripe\.com$/.test(new URL(url).hostname);
  handles.push(await App.addListener('resume', () => void check()));
  if (card) {
    handles.push(await Browser.addListener('browserFinished', () => void check()));
    await Browser.open({ url, presentationStyle: 'popover' });
  } else {
    await AppLauncher.openUrl({ url });
  }
  // A reservation never lasts longer than 30 minutes; stop watching after that.
  window.setTimeout(() => finish(false), 31 * 60_000);
}

export function stopWatchingPayment(): void {
  stop?.();
}
