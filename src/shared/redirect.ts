/**
 * A same-site path to send someone back to (after signing in), or `fallback`.
 * The value is resolved the way a browser would resolve it — browsers drop tabs and newlines and read `\`
 * as `/` — so tricks like `/<TAB>/evil.example` or `/\evil.example` can never become a link to another site.
 */
export function safeReturnPath(value: string | null | undefined, fallback = '/'): string {
  if (!value || typeof value !== 'string' || value.length > 500) return fallback;
  // eslint-disable-next-line no-control-regex
  if (!value.startsWith('/') || /[\u0000-\u001f\u007f\\]/.test(value)) return fallback;
  let url: URL;
  try {
    url = new URL(value, 'https://tikit.invalid');
  } catch {
    return fallback;
  }
  if (url.origin !== 'https://tikit.invalid') return fallback;
  return `${url.pathname}${url.search}${url.hash}`;
}
