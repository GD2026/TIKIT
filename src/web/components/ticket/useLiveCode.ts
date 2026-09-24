import { useEffect, useState } from 'react';
import { LIMITS } from '../../../shared/constants';
import { createTicketCode, qrStep } from '../../../shared/qr';

export interface LiveCode {
  code: string | null;
  /** Current step index (changes every `qrStepSeconds`). */
  step: number;
  /** Milliseconds into the current step, for the countdown ring. */
  elapsedMs: number;
  /** Corrected "now" (device clock + server offset). */
  now: number;
}

/**
 * The rotating ticket code ("levende billett"). Computed on the device from the ticket's secret, so it
 * keeps working offline. `offsetMs` corrects a phone clock that is off.
 */
export function useLiveCode(ticketId: string, secret: string | null, offsetMs: number, active = true): LiveCode {
  const stepMs = LIMITS.qrStepSeconds * 1000;
  const [now, setNow] = useState(() => Date.now() + offsetMs);
  const [code, setCode] = useState<{ step: number; value: string } | null>(null);

  useEffect(() => {
    if (!active) return;
    setNow(Date.now() + offsetMs);
    const t = window.setInterval(() => setNow(Date.now() + offsetMs), 1000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') setNow(Date.now() + offsetMs);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [offsetMs, active]);

  const step = qrStep(now);
  useEffect(() => {
    if (!secret || !active) return;
    let alive = true;
    void createTicketCode(ticketId, secret, step * stepMs + 1).then((value) => {
      if (alive) setCode({ step, value });
    });
    return () => {
      alive = false;
    };
  }, [ticketId, secret, step, stepMs, active]);

  return { code: secret && code ? code.value : null, step, elapsedMs: now - step * stepMs, now };
}
