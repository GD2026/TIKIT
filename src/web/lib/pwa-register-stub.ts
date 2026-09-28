/** Stand-in for `virtual:pwa-register` in the demo build, which has no service worker. */
export function registerSW(_options?: unknown): (reload?: boolean) => Promise<void> {
  return async () => {};
}
