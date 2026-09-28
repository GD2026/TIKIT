/** Optional headers Vipps MobilePay asks integrators to send on every call (used for debugging on their side). */
export const VIPPS_SYSTEM_HEADERS: Record<string, string> = {
  'Vipps-System-Name': 'tikit',
  'Vipps-System-Version': '1.0.0',
  'Vipps-System-Plugin-Name': 'tikit-server',
  'Vipps-System-Plugin-Version': '1.0.0',
};

export interface VippsApiConfig {
  /** https://api.vipps.no in production, https://apitest.vipps.no for the test environment. */
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  subscriptionKey: string;
  merchantSerialNumber: string;
}

/**
 * Access tokens from `POST /accesstoken/get` (valid 1 h in test, 24 h in production).
 * Cached per process and refreshed five minutes before expiry.
 */
export function createVippsTokenSource(cfg: VippsApiConfig, fetchImpl: typeof fetch = fetch): () => Promise<string> {
  let token: string | null = null;
  let expiresAt = 0;
  let inflight: Promise<string> | null = null;
  return async () => {
    if (token && Date.now() < expiresAt - 5 * 60_000) return token;
    if (inflight) return inflight;
    inflight = (async () => {
      const res = await fetchImpl(`${cfg.baseUrl}/accesstoken/get`, {
        method: 'POST',
        headers: {
          client_id: cfg.clientId,
          client_secret: cfg.clientSecret,
          'Ocp-Apim-Subscription-Key': cfg.subscriptionKey,
          'Merchant-Serial-Number': cfg.merchantSerialNumber,
          ...VIPPS_SYSTEM_HEADERS,
        },
      });
      if (!res.ok) throw new Error(`Vipps accesstoken ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const data = (await res.json()) as { access_token: string; expires_in: number | string };
      token = data.access_token;
      expiresAt = Date.now() + Number(data.expires_in) * 1000;
      return token;
    })();
    try {
      return await inflight;
    } finally {
      inflight = null;
    }
  };
}
