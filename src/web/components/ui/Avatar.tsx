import { cn } from '../../lib/cn';

const COLORS = ['#3B4CF2', '#E3163A', '#12B886', '#9D4EDD', '#FF5E3A', '#1768AC', '#C0692A', '#F7B801'];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]![0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]![0] ?? '') : '';
  return (first + last).toUpperCase();
}

export function Avatar({ name, size = 40, className }: { name: string; size?: number; className?: string }) {
  const color = COLORS[hash(name) % COLORS.length];
  return (
    <span
      aria-hidden="true"
      className={cn('inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white', className)}
      style={{ width: size, height: size, fontSize: size * 0.38, background: `linear-gradient(145deg, ${color}, color-mix(in srgb, ${color} 60%, black))` }}
    >
      {initials(name)}
    </span>
  );
}
