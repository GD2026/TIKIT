/**
 * Registers TIKIT's payment webhook with Vipps MobilePay and prints the secret to put in
 * VIPPS_WEBHOOK_SECRET. Run once per environment:  npm run vipps:webhook
 * Uses PUBLIC_URL and the VIPPS_* variables from .env (or the environment).
 */
import { existsSync } from 'node:fs';
import { createVippsTokenSource, VIPPS_SYSTEM_HEADERS } from '../src/node/vippsCommon';
import { loadConfig } from '../src/node/config';

if (existsSync('.env')) process.loadEnvFile('.env');
const cfg = loadConfig();
if (!cfg.vipps) {
  console.error('Sett VIPPS_CLIENT_ID, VIPPS_CLIENT_SECRET, VIPPS_SUBSCRIPTION_KEY og VIPPS_MSN først.');
  process.exit(1);
}
if (!cfg.publicUrl.startsWith('https://')) {
  console.error('PUBLIC_URL må være en offentlig https-adresse – Vipps kan ikke nå localhost.');
  process.exit(1);
}
const v = cfg.vipps;
const token = await createVippsTokenSource({ baseUrl: v.baseUrl, clientId: v.clientId, clientSecret: v.clientSecret, subscriptionKey: v.subscriptionKey, merchantSerialNumber: v.msn })();
const headers = {
  Authorization: `Bearer ${token}`,
  'Ocp-Apim-Subscription-Key': v.subscriptionKey,
  'Merchant-Serial-Number': v.msn,
  'Content-Type': 'application/json',
  ...VIPPS_SYSTEM_HEADERS,
};
const url = `${cfg.publicUrl}/api/webhooks/vipps`;

const existing = await fetch(`${v.baseUrl}/webhooks/v1/webhooks`, { headers });
if (existing.ok) {
  const list = (await existing.json()) as { webhooks?: { id: string; url: string; events: string[] }[] };
  const same = (list.webhooks ?? []).filter((w) => w.url === url);
  if (same.length > 0 && !process.argv.includes('--replace')) {
    console.log(`Webhooken finnes allerede (${same.map((w) => w.id).join(', ')}).`);
    console.log('Secret vises bare når den lages. Kjør med --replace for å lage en ny.');
    process.exit(0);
  }
  for (const w of same) {
    await fetch(`${v.baseUrl}/webhooks/v1/webhooks/${w.id}`, { method: 'DELETE', headers });
    console.log(`Slettet gammel webhook ${w.id}`);
  }
}

const events = [
  'epayments.payment.authorized.v1',
  'epayments.payment.aborted.v1',
  'epayments.payment.expired.v1',
  'epayments.payment.cancelled.v1',
  'epayments.payment.captured.v1',
  'epayments.payment.refunded.v1',
  'epayments.payment.terminated.v1',
];
const res = await fetch(`${v.baseUrl}/webhooks/v1/webhooks`, { method: 'POST', headers, body: JSON.stringify({ url, events }) });
if (!res.ok) {
  console.error(`Registrering feilet (${res.status}): ${await res.text()}`);
  process.exit(1);
}
const created = (await res.json()) as { id: string; secret: string };
console.log(`Webhook registrert for ${url} (id ${created.id}).`);
console.log('\nLegg dette inn i miljøvariablene og start serveren på nytt:\n');
console.log(`VIPPS_WEBHOOK_SECRET=${created.secret}\n`);
