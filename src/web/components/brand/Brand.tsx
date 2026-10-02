import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';
import { Spinner } from '../ui/Feedback';
import { ICON_SIZE, ICON_WORDMARK_X, ICON_WORDMARK_Y, WORDMARK_HEIGHT, WORDMARK_PATH, WORDMARK_WIDTH } from './wordmark';

/** The app icon: the white wordmark on black, as on the home screen. */
export function LogoMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox={`0 0 ${ICON_SIZE} ${ICON_SIZE}`} width={size} height={size} className={className} aria-hidden="true">
      {/* The hairline keeps the black tile visible on a black background (dark mode). */}
      <rect x="4" y="4" width={ICON_SIZE - 8} height={ICON_SIZE - 8} rx="240" fill="#000" stroke="rgba(255,255,255,0.18)" strokeWidth="8" />
      <path transform={`translate(${ICON_WORDMARK_X} ${ICON_WORDMARK_Y})`} fill="#fff" d={WORDMARK_PATH} />
    </svg>
  );
}

/** The TIKIT wordmark in the text colour (black in light mode, white in dark mode). */
export function Wordmark({ height = 18, className }: { height?: number; className?: string }) {
  return (
    <svg
      viewBox={`0 0 ${WORDMARK_WIDTH} ${WORDMARK_HEIGHT}`}
      height={height}
      width={Math.round((height * WORDMARK_WIDTH) / WORDMARK_HEIGHT)}
      className={cn('shrink-0', className)}
      fill="currentColor"
      role="img"
      aria-label="TIKIT"
    >
      <path d={WORDMARK_PATH} />
    </svg>
  );
}

/** The logo in the app's chrome. `size` is the height of the space it fills. */
export function Logo({ className, size = 30 }: { className?: string; size?: number }) {
  return (
    <span className={cn('inline-flex items-center', className)}>
      <Wordmark height={Math.round(size * 0.6)} />
    </span>
  );
}

// ── Sign-in buttons (brand rules: Vipps orange with white text; Apple black/white; Google neutral with the G) ──

interface ProviderButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  loading?: boolean;
  verb?: 'continue' | 'login';
}

// 19 px: Vipps' white-on-orange (3.1:1) must be WCAG "large text", so the whole group shares that size.
const providerBase =
  'press relative flex h-12 w-full items-center justify-center gap-2.5 rounded-full px-6 text-[1.1875rem] outline-none disabled:opacity-50';

export function VippsButton({ loading, verb = 'continue', className, ...rest }: ProviderButtonProps) {
  return (
    <button type="button" className={cn(providerBase, 'bg-[var(--vipps)] font-bold text-white hover:bg-[var(--vipps-pressed)]', className)} {...rest}>
      {loading ? <Spinner className="text-white" /> : null}
      <span>
        {verb === 'login' ? 'Logg inn med' : 'Fortsett med'} <span className="font-extrabold">Vipps</span>
      </span>
    </button>
  );
}

export function AppleButton({ loading, className, ...rest }: ProviderButtonProps) {
  return (
    <button type="button" className={cn(providerBase, 'bg-label font-semibold text-bg hover:opacity-90', className)} {...rest}>
      {loading ? (
        <Spinner className="text-current" />
      ) : (
        <svg viewBox="0 0 24 24" className="-mt-0.5 h-[21px] w-[21px]" aria-hidden="true" fill="currentColor">
          <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701" />
        </svg>
      )}
      <span>Fortsett med Apple</span>
    </button>
  );
}

export function GoogleGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

export function GoogleButton({ loading, className, ...rest }: ProviderButtonProps) {
  return (
    <button
      type="button"
      className={cn(providerBase, 'bg-[var(--google-bg)] font-semibold text-[var(--google-fg)] shadow-[inset_0_0_0_1px_var(--google-border)] hover:brightness-[0.98]', className)}
      {...rest}
    >
      {loading ? <Spinner className="text-current" /> : <GoogleGlyph className="h-5 w-5" />}
      <span>Fortsett med Google</span>
    </button>
  );
}
