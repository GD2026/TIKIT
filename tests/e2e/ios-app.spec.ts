import { expect, test, type Page, type Request } from '@playwright/test';

/**
 * The iOS app's web layer (src/web/native/) in Chromium: the `native` build served from its own origin,
 * calling the API on another origin with a bearer token – as the app does from capacitor://localhost.
 * The native plugin itself (Keychain, ASWebAuthenticationSession) only exists on a device; here its calls
 * fail and the app keeps the token in memory, which is what these tests rely on.
 */

const API = 'http://localhost:8901';

function watchApi(page: Page): Request[] {
  const calls: Request[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/')) calls.push(r);
  });
  return calls;
}

test('the app loads events and pictures from the server, not from its own origin', async ({ page }) => {
  const calls = watchApi(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Utforsk', level: 1 })).toBeVisible();
  await page.goto('/e/russetreff-vest');
  await expect(page.getByRole('heading', { name: 'Billetter' })).toBeVisible();
  expect(calls.length).toBeGreaterThan(0);
  expect(calls.every((r) => r.url().startsWith(`${API}/api/`))).toBe(true);
});

test('buys tickets with a bearer token and comes back from the payment through /app/…', async ({ page, context }) => {
  const calls = watchApi(page);
  await page.goto('/e/russetreff-vest');
  const more = page.getByRole('button', { name: 'Flere: Ordinær' });
  await more.click();
  await page.getByRole('button', { name: /Til betaling/ }).click();
  await page.getByRole('button', { name: /Fortsett med Vipps/ }).first().click();
  await page.getByRole('button', { name: /Fortsett med Vipps \(demo\)/ }).click();
  await page.waitForURL(/\/kasse\//);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: /Betal .* med Vipps/ }).click();
  await page.waitForURL(/\/demo\/betal\//);
  await page.getByRole('button', { name: /Godkjenn betalingen/ }).click();

  // The provider returns to https://…/app/ordre/<id>; inside the app that is the ordinary order page.
  await page.waitForURL(/\/ordre\//);
  expect(new URL(page.url()).pathname.startsWith('/app/')).toBe(false);
  await expect(page.getByRole('heading', { name: 'Kjøpet er fullført!' })).toBeVisible();

  // Signed-in calls carry the token; no cookie session exists for the app.
  const pay = calls.find((r) => /\/api\/orders\/[^/]+\/pay$/.test(r.url()));
  expect(pay?.headers().authorization).toMatch(/^Bearer /);
  expect(pay?.postDataJSON()).toMatchObject({ client: 'ios' });
  expect((await context.cookies(API)).some((c) => c.name === 'tikit_sid')).toBe(false);

  // Tickets open without a network connection (offline copy in the app). The app's own files are in the
  // bundle on a phone, so only the server is cut off here.
  await page.getByRole('link', { name: /Vis billetten/ }).click();
  await page.waitForURL(/\/billetter/);
  await page.goto('/billetter');
  await page.getByRole('link', { name: /Russetreff Vest/ }).first().click();
  await expect(page.getByRole('img', { name: /QR-kode for billett TK-/ }).first()).toBeVisible();
  await page.goBack();
  await page.route(`${API}/**`, (route) => route.abort('internetdisconnected'));
  await page.getByRole('link', { name: /Russetreff Vest/ }).first().click();
  await expect(page.getByRole('img', { name: /QR-kode for billett TK-/ }).first()).toBeVisible();
  await page.unroute(`${API}/**`);

  // Links people share point at the website, not at the app's own origin.
  await page.getByRole('button', { name: /Overfør til en venn/ }).first().click();
  await page.getByRole('dialog', { name: 'Overfør billetten' }).getByRole('button', { name: 'Lag overføringslenke' }).click();
  await expect(page.getByText(new RegExp(`^${API.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}/overfor/`)).first()).toBeVisible();
});

test('shows no install-the-app help and no Android in the app', async ({ page }) => {
  await page.goto('/hjelp');
  await expect(page.getByRole('heading', { name: 'Hjelp', level: 1 })).toBeVisible();
  await expect(page.getByText('Android')).toHaveCount(0);
  await expect(page.getByText(/Legg til på Hjem-skjerm/)).toHaveCount(0);
});
