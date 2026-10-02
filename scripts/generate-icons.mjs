// Renders the TIKIT app icons, the Wallet pass images and the link-preview image into public/, and the iOS app
// icon and launch image into ios/App/App/Assets.xcassets (run: npm run icons).
// The logo is the designer's wordmark (src/web/components/brand/wordmark.ts, traced from assets/brand/tikit-logo.png),
// rendered with the Chromium that ships with Playwright so it matches the in-app logo exactly.
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { inflateSync, deflateSync } from 'node:zlib';
import { chromium } from '@playwright/test';
import { ICON_SIZE as S, ICON_WORDMARK_X, ICON_WORDMARK_Y, WORDMARK_HEIGHT, WORDMARK_PATH, WORDMARK_WIDTH } from '../src/web/components/brand/wordmark.ts';

const C = S / 2;
const svgOpen = (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">`;
const placedWordmark = `<path transform="translate(${ICON_WORDMARK_X} ${ICON_WORDMARK_Y})" fill="#fff" d="${WORDMARK_PATH}"/>`;
const around = (scale, body) => `<g transform="translate(${C} ${C}) scale(${scale}) translate(${-C} ${-C})">${body}</g>`;

/** Full-bleed square as the designer drew it: iOS and Android round the corners. `scale` shrinks it into a safe zone. */
const square = (scale) => `${svgOpen(S, S)}<rect width="${S}" height="${S}" fill="#000"/>${around(scale, placedWordmark)}</svg>`;
/** Browser tab: a rounded tile with the wordmark a little larger, since it is shown at 16–32 px. */
const favicon = `${svgOpen(S, S)}<rect width="${S}" height="${S}" rx="240" fill="#000"/>${around(1.08, placedWordmark)}</svg>`;
/** The white wordmark alone, on transparent. */
const wordmark = `${svgOpen(WORDMARK_WIDTH, WORDMARK_HEIGHT)}<path fill="#fff" d="${WORDMARK_PATH}"/></svg>`;
const wordmarkWidth = (height) => Math.round((height * WORDMARK_WIDTH) / WORDMARK_HEIGHT);

mkdirSync('public/icons', { recursive: true });
writeFileSync('public/favicon.svg', favicon);

const font = readFileSync('node_modules/@fontsource-variable/archivo/files/archivo-latin-wdth-normal.woff2').toString('base64');
const browser = await chromium.launch();
const page = await browser.newPage();

async function png(svg, width, file, height = width) {
  await page.setViewportSize({ width, height });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${width}" height="${height}" `)}</body></html>`);
  return page.screenshot({ path: file, omitBackground: true, clip: { x: 0, y: 0, width, height } });
}

await png(square(1), 180, 'public/apple-touch-icon.png');
await png(square(1), 192, 'public/icons/icon-192.png');
await png(square(1), 512, 'public/icons/icon-512.png');
// Maskable: keep the wordmark inside the central 80 % circle.
await png(square(0.8), 512, 'public/icons/icon-maskable-512.png');

// Apple Wallet passes (src/node/integrations/apple/wallet.ts): the icon on the lock screen, and the wordmark as
// the logo at the top of the pass (Apple's logo area is at most 160×50 points).
mkdirSync('public/wallet', { recursive: true });
for (const [scale, suffix] of [[1, ''], [2, '@2x'], [3, '@3x']]) {
  await png(square(1), 29 * scale, `public/wallet/icon${suffix}.png`);
  await png(wordmark, wordmarkWidth(30) * scale, `public/wallet/logo${suffix}.png`, 30 * scale);
}

// Link preview (1200×630) for shared event links without their own cover image.
await page.setViewportSize({ width: 1200, height: 630 });
await page.setContent(`<html><head><style>
  @font-face { font-family: 'Archivo Display'; src: url(data:font/woff2;base64,${font}) format('woff2'); font-weight: 100 900; font-stretch: 62% 125%; }
  body { margin: 0; width: 1200px; height: 630px; overflow: hidden; background: #000; font-family: 'Archivo Display', sans-serif; color: #fff; }
  .wrap { position: absolute; left: 96px; top: 0; bottom: 0; display: flex; flex-direction: column; justify-content: center; gap: 48px; }
  p { margin: 0; font-size: 44px; font-weight: 600; font-stretch: 100%; color: rgba(255,255,255,.82); max-width: 900px; line-height: 1.2; }
</style></head><body><div class="wrap">${wordmark.replace('<svg ', `<svg width="${wordmarkWidth(170)}" height="170" `)}<p>Billetter til russetreff, fester, revyer og konserter.</p></div></body></html>`);
await page.waitForTimeout(200);
await page.screenshot({ path: 'public/og.png', clip: { x: 0, y: 0, width: 1200, height: 630 } });

// ── iOS app ────────────────────────────────────────────────────────────────
// App Store Connect refuses icons with an alpha channel, so the PNG is rewritten as plain RGB.
const assets = 'ios/App/App/Assets.xcassets';
if (existsSync(assets)) {
  const icon = `${assets}/AppIcon.appiconset/AppIcon-512@2x.png`;
  await png(square(1), 1024, icon);
  writeFileSync(icon, toRgbPng(readFileSync(icon)));

  // Launch image: shown scaled to fill the screen, so the wordmark sits in the middle of a large square.
  await page.setViewportSize({ width: 2732, height: 2732 });
  // Flat black (the same as SplashScreen.backgroundColor in capacitor.config.ts) keeps the file small.
  await page.setContent(`<html><body style="margin:0;width:2732px;height:2732px;display:grid;place-items:center;background:#000">${wordmark.replace('<svg ', `<svg width="${wordmarkWidth(180)}" height="180" `)}</body></html>`);
  const splash = toRgbPng(await page.screenshot({ clip: { x: 0, y: 0, width: 2732, height: 2732 } }));
  for (const name of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png']) writeFileSync(`${assets}/Splash.imageset/${name}`, splash);
  console.log('iOS: appikon (1024, uten gjennomsiktighet) og oppstartsbilde er laget.');
}

await browser.close();
console.log('Ikoner og forhåndsvisning er laget i public/.');

/** Rewrites an 8-bit PNG (RGB or RGBA, not interlaced) as 8-bit RGB with no alpha channel. */
function toRgbPng(buf) {
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const colorType = buf[25];
  if (buf[24] !== 8 || buf[28] !== 0 || (colorType !== 2 && colorType !== 6)) throw new Error('Uventet PNG-format');
  if (colorType === 2) return buf;
  const idat = [];
  for (let i = 8; i < buf.length; ) {
    const len = buf.readUInt32BE(i);
    const type = buf.toString('ascii', i + 4, i + 8);
    if (type === 'IDAT') idat.push(buf.subarray(i + 8, i + 8 + len));
    i += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = 4;
  const stride = width * bpp;
  const prev = Buffer.alloc(stride);
  const line = Buffer.alloc(stride);
  const out = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? line[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let v = src[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[x] = v & 0xff;
    }
    const o = y * (1 + width * 3);
    out[o] = 0;
    for (let x = 0; x < width; x++) line.copy(out, o + 1 + x * 3, x * 4, x * 4 + 3);
    line.copy(prev);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([buf.subarray(0, 8), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(out, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

function crc32(data) {
  let c = ~0;
  for (const byte of data) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}
