import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/** Serious and critical WCAG 2.2 A/AA problems fail the test; the list is printed to make fixing easy. */
async function expectAccessible(page: Page, context: string) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    // Brand marks (the Vipps logotype) are exempt from contrast requirements (WCAG 1.4.3 "Logotypes").
    .exclude('[data-brand-mark]')
    .analyze();
  const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  const summary = bad.map(
    (v) =>
      `${v.id} (${v.impact}): ${v.help}\n` +
      v.nodes
        .slice(0, 6)
        .map((n) => `    ${n.target.join(' ')}\n      ${(n.failureSummary ?? '').replace(/\s+/g, ' ').slice(0, 260)}`)
        .join('\n'),
  );
  expect(summary, `${context}: tilgjengelighetsfeil`).toEqual([]);
}

/** Demo login as Emma (the seeded buyer) from the login sheet or page. */
async function loginAsBuyer(page: Page) {
  await page.getByRole('button', { name: /Fortsett med Vipps/ }).first().click();
  await page.getByRole('button', { name: /Fortsett med Vipps \(demo\)/ }).click();
}

test.describe('kjøper', () => {
  test('utforsk og arrangementsside er tilgjengelige', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Utforsk', level: 1 })).toBeVisible();
    await expectAccessible(page, 'Utforsk');
    await page.goto('/e/russetreff-vest');
    await expect(page.getByRole('heading', { name: 'Billetter' })).toBeVisible();
    await expectAccessible(page, 'Arrangement');
  });

  test('kjøper to billetter med Vipps og får levende billetter', async ({ page }) => {
    await page.goto('/e/russetreff-vest');
    const more = page.getByRole('button', { name: 'Flere: Ordinær' });
    await more.click();
    await more.click();
    await expect(page.getByText('2 billetter inkl. gebyr')).toBeVisible();
    await page.getByRole('button', { name: /Til betaling/ }).click();

    // Not logged in: log in, and the purchase continues by itself.
    await loginAsBuyer(page);
    await page.waitForURL(/\/kasse\//);
    await expect(page.getByText('Billettene er reservert til deg')).toBeVisible();
    await expectAccessible(page, 'Kasse');

    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: /Betal .* med Vipps/ }).click();
    await page.waitForURL(/\/demo\/betal\//);
    await page.getByRole('button', { name: /Godkjenn betalingen/ }).click();

    await page.waitForURL(/\/ordre\//);
    await expect(page.getByRole('heading', { name: 'Kjøpet er fullført!' })).toBeVisible();
    await expectAccessible(page, 'Ordrebekreftelse');

    await page.getByRole('link', { name: /Vis billettene/ }).click();
    await page.waitForURL(/\/billetter/);
    await page.getByRole('link', { name: /Russetreff Vest/ }).first().click();
    await expect(page.getByRole('img', { name: /QR-kode for billett TK-/ }).first()).toBeVisible();
    await expect(page.getByText(/Levende billett · ny kode om \d+ s/).first()).toBeVisible();
    await expectAccessible(page, 'Billett');
  });

  test('en billett kan overføres med lenke', async ({ page }) => {
    await page.goto('/logg-inn');
    await loginAsBuyer(page);
    await page.waitForURL((url) => !url.pathname.startsWith('/logg-inn'));
    await page.goto('/billetter');
    await page.getByRole('link', { name: /Russetreff Vest/ }).first().click();
    await page.getByRole('button', { name: /Overfør til en venn/ }).first().click();
    const sheet = page.getByRole('dialog', { name: 'Overfør billetten' });
    await sheet.getByRole('button', { name: 'Lag overføringslenke' }).click();
    await expect(page.getByRole('dialog', { name: 'Klar til å sende' })).toBeVisible();
    await expect(page.getByText(/^http:\/\/localhost:\d+\//).first()).toBeVisible();
    await expectAccessible(page, 'Overføring');

    // Take it back again: the link stops working and the ticket gets a fresh QR code.
    await page.getByRole('button', { name: 'Ferdig' }).click();
    await page.getByRole('button', { name: 'Avbryt overføringen' }).first().click();
    await page.getByRole('button', { name: 'Avbryt overføring', exact: true }).click();
    await expect(page.getByText('Overføringen er avbrutt')).toBeVisible();
    await expect(page.getByRole('img', { name: /QR-kode for billett TK-/ }).first()).toBeVisible();
  });
});

test.describe('arrangør og dør', () => {
  test('arrangør ser salg, og døra sjekker inn en billett', async ({ page }) => {
    // The demo panel switches persona (Jonas runs Nordlys Events).
    await page.goto('/profil');
    await page.getByRole('button', { name: 'Åpne demo-panelet' }).first().click();
    await page.getByRole('button', { name: /Arrangør – Jonas/ }).click();
    await page.waitForURL(/\/arrangor\//);
    await expect(page.getByRole('heading', { name: 'Oversikt', level: 1 })).toBeVisible();
    await expectAccessible(page, 'Arrangøroversikt');

    await page.getByRole('link', { name: /Arrangementer|Eventer/ }).first().click();
    await page.locator('main a[href*="/arrangementer/"]:not([href$="/ny"])').first().click();
    await expect(page.getByText('Solgt').first()).toBeVisible();
    await expectAccessible(page, 'Arrangement (arrangør)');

    const hub = page.url();
    await page.goto(hub.replace(/arrangor\/[^/]+\/arrangementer\//, 'skann/'));
    // Headless Chromium has no camera, so the scanner offers manual check-in and demo scans.
    await page.getByRole('button', { name: /Skann en gyldig billett/ }).click();
    await expect(page.getByRole('alertdialog', { name: 'Gyldig billett' })).toBeVisible();
    await page.getByRole('button', { name: 'Neste' }).click();
    await page.getByRole('button', { name: /Skann et skjermbilde/ }).click();
    await expect(page.getByRole('alertdialog', { name: /Utløpt kode/ })).toBeVisible();
  });
});

test.describe('flere sider', () => {
  test('søk, profil og hjelp er tilgjengelige', async ({ page }) => {
    for (const [path, name] of [
      ['/sok', 'Søk'],
      ['/profil', 'Profil'],
      ['/hjelp', 'Hjelp'],
      ['/vilkar', 'Kjøpsvilkår'],
      ['/skann', 'Skanner'],
    ] as const) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await expectAccessible(page, name);
    }
  });

  test('arrangørverktøy og admin er tilgjengelige', async ({ page }) => {
    await page.goto('/profil');
    await page.getByRole('button', { name: 'Åpne demo-panelet' }).first().click();
    await page.getByRole('button', { name: /Arrangør – Jonas/ }).click();
    await page.waitForURL(/\/arrangor\//);
    const base = page.url().split('?')[0]!.replace(/\/$/, '');
    await page.goto(`${base}/arrangementer`);
    await page.locator('main a[href*="/arrangementer/"]:not([href$="/ny"])').first().click();
    await page.waitForLoadState('networkidle');
    const hub = page.url();
    for (const [suffix, name] of [
      ['/billettyper', 'Billettyper'],
      ['/ordre', 'Ordre'],
      ['/deltakere', 'Deltakere'],
      ['/rabattkoder', 'Rabattkoder'],
      ['/innsjekk', 'Innsjekk'],
      ['/rediger', 'Rediger arrangement'],
    ] as const) {
      await page.goto(hub + suffix);
      await page.waitForLoadState('networkidle');
      await expectAccessible(page, name);
    }
    for (const [suffix, name] of [
      ['/oppgjor', 'Oppgjør'],
      ['/team', 'Team'],
      ['/innstillinger', 'Innstillinger'],
    ] as const) {
      await page.goto(base + suffix);
      await page.waitForLoadState('networkidle');
      await expectAccessible(page, name);
    }

    await page.goto('/profil');
    await page.getByRole('button', { name: 'Åpne demo-panelet' }).first().click();
    await page.getByRole('button', { name: /Plattformadmin – Mari/ }).click();
    await page.waitForURL(/\/admin/);
    for (const [path, name] of [
      ['/admin', 'Admin'],
      ['/admin/arrangorer', 'Admin arrangører'],
      ['/admin/arrangementer', 'Admin arrangementer'],
      ['/admin/brukere', 'Admin brukere'],
      ['/admin/innstillinger', 'Admin gebyrer'],
    ] as const) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await expectAccessible(page, name);
    }
  });
});
