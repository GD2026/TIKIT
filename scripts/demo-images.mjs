// Downloads the Higgsfield cover pictures for the demo events (assets/demo-events/manifest.json) and
// stores them as JPEG next to the manifest. Run once: npm run demo:images – then reset the demo data
// (delete ./data, or restart the Render demo) so the events get their pictures.
// Uses the Chromium that ships with Playwright to scale and re-encode, so no image library is needed.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const dir = 'assets/demo-events';
const manifest = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
const force = process.argv.includes('--force');
const WIDTH = 1600;
const HEIGHT = 1200;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
let done = 0;
for (const img of manifest.images) {
  const out = path.join(dir, `${img.slug}.jpg`);
  if (existsSync(out) && !force) {
    console.log(`✓ ${img.slug} (finnes)`);
    continue;
  }
  const res = await fetch(img.url);
  if (!res.ok) {
    console.error(`✗ ${img.slug}: ${res.status} – åpne Higgsfield-prosjektet «TIKIT – demobilder» og last ned bildet manuelt til ${out}`);
    process.exitCode = 1;
    continue;
  }
  const src = `data:image/png;base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`;
  await page.setContent(`<html><body style="margin:0"><img id="i" src="${src}" style="width:${WIDTH}px;height:${HEIGHT}px;object-fit:cover;display:block"></body></html>`);
  await page.waitForFunction(() => document.getElementById('i')?.complete);
  writeFileSync(out, await page.screenshot({ type: 'jpeg', quality: 78, clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT } }));
  console.log(`✓ ${img.slug}`);
  done++;
}
await browser.close();
console.log(`${done} bilder lagret i ${dir}/. Nullstill demodataene (slett ./data) for å ta dem i bruk.`);
