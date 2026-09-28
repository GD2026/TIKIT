import { isDemoBuild } from './device';

/** Copies text; resolves true on success. Must be called from a user gesture. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

/** Opens the native share sheet when available; otherwise copies the link. */
export async function shareLink(data: { title: string; text?: string; url: string }): Promise<'shared' | 'copied' | 'failed'> {
  if (!isDemoBuild && typeof navigator.share === 'function') {
    try {
      await navigator.share(data);
      return 'shared';
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return 'shared';
    }
  }
  return (await copyText(data.url)) ? 'copied' : 'failed';
}
