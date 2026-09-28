import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type { SeedImage } from '../server/seed';

/**
 * Cover pictures for the demo events: assets/demo-events/<slug>.jpg, downloaded from Higgsfield with
 * `npm run demo:images`. Missing files are fine – those events keep their generated posters.
 */
export function loadDemoCovers(dir = 'assets/demo-events'): Map<string, SeedImage> {
  const covers = new Map<string, SeedImage>();
  if (!existsSync(dir)) return covers;
  for (const file of readdirSync(dir)) {
    const m = /^([a-z0-9-]+)\.jpe?g$/.exec(file);
    if (!m) continue;
    const bytes = readFileSync(path.join(dir, file));
    const size = jpegSize(bytes);
    if (!size) continue;
    covers.set(m[1]!, { mime: 'image/jpeg', data: bytes.toString('base64'), width: size.width, height: size.height, bytes: bytes.length });
  }
  return covers;
}

/** Width and height from the JPEG's SOF segment. */
function jpegSize(b: Buffer): { width: number; height: number } | null {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1]!;
    const len = b.readUInt16BE(i + 2);
    // SOF0–SOF15 except DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  return null;
}
