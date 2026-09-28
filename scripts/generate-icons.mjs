// Renders the TIKIT app icons and the link-preview image into public/ (run: npm run icons).
// Uses the Chromium that ships with Playwright, so the result matches the in-app logo exactly.
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const GRADIENT = `<linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1B1464"/><stop offset="0.62" stop-color="#3B4CF2"/><stop offset="1" stop-color="#FF6FB5"/></linearGradient>`;
const TICKET = `<g transform="rotate(-14 32 32)">
  <path d="M14 21a4 4 0 0 1 4-4h28a4 4 0 0 1 4 4v5a6 6 0 0 0 0 12v5a4 4 0 0 1-4 4H18a4 4 0 0 1-4-4v-5a6 6 0 0 0 0-12z" fill="#fff"/>
  <path d="M37 20v24" stroke="#3B4CF2" stroke-width="2.4" stroke-dasharray="2.6 3.2" stroke-linecap="round"/>
  <rect x="20" y="27" width="11" height="3.4" rx="1.7" fill="#1B1464"/>
  <rect x="20" y="33.6" width="7" height="3.4" rx="1.7" fill="#1B1464" opacity="0.45"/>
</g>`;

/** Rounded mark (favicon, in-app). */
const rounded = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs>${GRADIENT}</defs><rect width="64" height="64" rx="15" fill="url(#g)"/>${TICKET}</svg>`;
/** Full-bleed square: iOS and Android apply their own mask. `scale` shrinks the ticket into the safe zone. */
const square = (scale) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs>${GRADIENT}</defs><rect width="64" height="64" fill="url(#g)"/><g transform="translate(32 32) scale(${scale}) translate(-32 -32)">${TICKET}</g></svg>`;

mkdirSync('public/icons', { recursive: true });
writeFileSync('public/favicon.svg', rounded);

const font = readFileSync('node_modules/@fontsource-variable/archivo/files/archivo-latin-wdth-normal.woff2').toString('base64');
const browser = await chromium.launch();
const page = await browser.newPage();

async function png(svg, size, file) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: file, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}

await png(square(1), 180, 'public/apple-touch-icon.png');
await png(square(1), 192, 'public/icons/icon-192.png');
await png(square(1), 512, 'public/icons/icon-512.png');
// Maskable: keep the ticket inside the central 80 % circle.
await png(square(0.78), 512, 'public/icons/icon-maskable-512.png');

// Link preview (1200×630) for shared event links without their own cover image.
await page.setViewportSize({ width: 1200, height: 630 });
await page.setContent(`<html><head><style>
  @font-face { font-family: 'Archivo Display'; src: url(data:font/woff2;base64,${font}) format('woff2'); font-weight: 100 900; font-stretch: 62% 125%; }
  body { margin: 0; width: 1200px; height: 630px; overflow: hidden; background: #0b0a24; font-family: 'Archivo Display', sans-serif; color: #fff; }
  .bg { position: absolute; inset: 0; background: radial-gradient(900px 520px at 88% 12%, rgba(255,111,181,.55), transparent 60%), radial-gradient(900px 600px at 10% 100%, rgba(59,76,242,.75), transparent 62%), linear-gradient(135deg, #1b1464, #0b0a24 70%); }
  .wrap { position: absolute; left: 96px; top: 0; bottom: 0; display: flex; flex-direction: column; justify-content: center; gap: 28px; }
  .row { display: flex; align-items: center; gap: 28px; }
  h1 { margin: 0; font-size: 150px; font-weight: 900; font-stretch: 125%; letter-spacing: .02em; line-height: 1; }
  p { margin: 0; font-size: 44px; font-weight: 600; font-stretch: 100%; color: rgba(255,255,255,.88); max-width: 900px; line-height: 1.2; }
</style></head><body><div class="bg"></div><div class="wrap"><div class="row">${rounded.replace('<svg ', '<svg width="150" height="150" ')}<h1>TIKIT</h1></div><p>Billetter til russetreff, fester, revyer og konserter.</p></div></body></html>`);
await page.waitForTimeout(200);
await page.screenshot({ path: 'public/og.png', clip: { x: 0, y: 0, width: 1200, height: 630 } });

await browser.close();
console.log('Ikoner og forhåndsvisning er laget i public/.');
