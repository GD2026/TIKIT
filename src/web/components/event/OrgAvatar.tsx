import { posterPalette } from '../../../shared/constants';
import { initials } from '../ui/Avatar';
import { ApiImage } from './EventImage';
import { cn } from '../../lib/cn';

export function OrgAvatar({ name, logoUrl, palette, size = 44, className }: { name: string; logoUrl: string | null; palette: string; size?: number; className?: string }) {
  const [c0, c1] = posterPalette(palette);
  if (logoUrl) {
    return (
      <span aria-hidden="true" className={cn('inline-block shrink-0 overflow-hidden rounded-[12px] bg-fill-3', className)} style={{ width: size, height: size }}>
        <ApiImage src={logoUrl} alt="" className="h-full w-full" />
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cn('inline-flex shrink-0 items-center justify-center rounded-[12px] font-bold text-white', className)}
      style={{ width: size, height: size, fontSize: size * 0.36, background: `linear-gradient(145deg, ${c1}, ${c0})` }}
    >
      {initials(name)}
    </span>
  );
}
