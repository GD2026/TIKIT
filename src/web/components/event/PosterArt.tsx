import { memo, useId, useMemo } from 'react';
import { posterPalette } from '../../../shared/constants';
import type { PosterSpec } from '../../../shared/types';

function rng(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generated poster art for events without an uploaded image. Pure SVG (no filters) so long lists
 * stay smooth on phones. The event's palette also tints its live ticket.
 */
export const PosterArt = memo(function PosterArt({ poster, className, title }: { poster: PosterSpec; className?: string; title?: string }) {
  const uid = useId().replace(/:/g, '');
  const [c0, c1, c2] = posterPalette(poster.palette);
  const art = useMemo(() => {
    const r = rng(poster.seed + 17);
    const W = 400;
    const H = 500;
    switch (poster.style) {
      case 'aurora': {
        const blobs = Array.from({ length: 5 }, (_, i) => ({
          cx: 40 + r() * 320,
          cy: 40 + r() * 420,
          rx: 160 + r() * 160,
          ry: 120 + r() * 140,
          color: i % 2 === 0 ? c1 : c2,
          o: 0.55 + r() * 0.35,
        }));
        const lines = Array.from({ length: 7 }, (_, i) => {
          const y = 60 + i * 60 + r() * 20;
          return `M-20 ${y} C ${100 + r() * 60} ${y - 70 - r() * 50}, ${240 + r() * 60} ${y + 60 + r() * 40}, 420 ${y - 10}`;
        });
        return (
          <>
            <rect width={W} height={H} fill={c0} />
            <defs>
              {blobs.map((b, i) => (
                <radialGradient key={i} id={`${uid}b${i}`} cx="50%" cy="50%" r="50%">
                  <stop offset="0" stopColor={b.color} stopOpacity={b.o} />
                  <stop offset="1" stopColor={b.color} stopOpacity="0" />
                </radialGradient>
              ))}
            </defs>
            {blobs.map((b, i) => (
              <ellipse key={i} cx={b.cx} cy={b.cy} rx={b.rx} ry={b.ry} fill={`url(#${uid}b${i})`} />
            ))}
            {lines.map((d, i) => (
              <path key={i} d={d} fill="none" stroke="#fff" strokeOpacity={0.08 + (i % 3) * 0.04} strokeWidth={1.2} />
            ))}
          </>
        );
      }
      case 'rays': {
        const cx = 80 + r() * 240;
        const cy = 320 + r() * 120;
        const n = 18;
        const wedges = Array.from({ length: n }, (_, i) => {
          const a0 = (i / n) * Math.PI * 2;
          const a1 = ((i + 0.5) / n) * Math.PI * 2;
          const R = 900;
          return `M${cx} ${cy} L${cx + R * Math.cos(a0)} ${cy + R * Math.sin(a0)} L${cx + R * Math.cos(a1)} ${cy + R * Math.sin(a1)} Z`;
        });
        return (
          <>
            <defs>
              <linearGradient id={`${uid}g`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={c0} />
                <stop offset="1" stopColor={c1} />
              </linearGradient>
              <radialGradient id={`${uid}s`} cx="50%" cy="50%" r="50%">
                <stop offset="0" stopColor={c2} />
                <stop offset="0.7" stopColor={c2} stopOpacity="0.9" />
                <stop offset="1" stopColor={c2} stopOpacity="0" />
              </radialGradient>
            </defs>
            <rect width={W} height={H} fill={`url(#${uid}g)`} />
            {wedges.map((d, i) => (
              <path key={i} d={d} fill="#fff" fillOpacity={0.07} />
            ))}
            <circle cx={cx} cy={cy} r={120} fill={`url(#${uid}s)`} />
            <circle cx={cx} cy={cy} r={62} fill={c2} />
          </>
        );
      }
      case 'grid': {
        const horizon = 250 + r() * 60;
        const vLines = Array.from({ length: 17 }, (_, i) => {
          const x = -400 + i * 75;
          return `M200 ${horizon} L${x} ${H + 40}`;
        });
        const hLines = Array.from({ length: 9 }, (_, i) => {
          const t = (i + 1) / 9;
          return horizon + Math.pow(t, 2.2) * (H - horizon + 40);
        });
        const sunR = 90 + r() * 30;
        return (
          <>
            <defs>
              <linearGradient id={`${uid}g`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={c0} />
                <stop offset="0.55" stopColor={c1} stopOpacity="0.85" />
                <stop offset="1" stopColor={c0} />
              </linearGradient>
              <linearGradient id={`${uid}s`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={c2} />
                <stop offset="1" stopColor={c1} />
              </linearGradient>
              <clipPath id={`${uid}c`}>
                <rect x="0" y="0" width={W} height={horizon} />
              </clipPath>
            </defs>
            <rect width={W} height={H} fill={`url(#${uid}g)`} />
            <g clipPath={`url(#${uid}c)`}>
              <circle cx={200} cy={horizon - 10} r={sunR} fill={`url(#${uid}s)`} />
              {Array.from({ length: 6 }, (_, i) => (
                <rect key={i} x={0} y={horizon - 10 - sunR * 0.1 - i * 16} width={W} height={3 + i * 1.3} fill={c0} opacity={0.9} />
              ))}
            </g>
            <g stroke={c2} strokeOpacity={0.55} strokeWidth={1.4}>
              {vLines.map((d, i) => (
                <path key={i} d={d} />
              ))}
              {hLines.map((y, i) => (
                <line key={i} x1={0} x2={W} y1={y} y2={y} />
              ))}
            </g>
          </>
        );
      }
      case 'waves': {
        const bands = 7;
        const paths = Array.from({ length: bands }, (_, i) => {
          const base = 120 + i * 55;
          const amp = 18 + r() * 26;
          const phase = r() * Math.PI * 2;
          let d = `M0 ${H}`;
          for (let x = 0; x <= W; x += 20) {
            const y = base + Math.sin((x / W) * Math.PI * 2 * (1 + (i % 3) * 0.35) + phase) * amp;
            d += ` L${x} ${y.toFixed(1)}`;
          }
          d += ` L${W} ${H} Z`;
          return d;
        });
        return (
          <>
            <defs>
              <linearGradient id={`${uid}g`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={c2} />
                <stop offset="0.45" stopColor={c1} />
                <stop offset="1" stopColor={c0} />
              </linearGradient>
            </defs>
            <rect width={W} height={H} fill={`url(#${uid}g)`} />
            <circle cx={80 + r() * 240} cy={90 + r() * 40} r={46} fill="#fff" fillOpacity={0.85} />
            {paths.map((d, i) => (
              <path key={i} d={d} fill={c0} fillOpacity={0.18 + i * 0.1} />
            ))}
          </>
        );
      }
      case 'orbit': {
        const cx = 200 + (r() - 0.5) * 120;
        const cy = 230 + (r() - 0.5) * 120;
        const rings = Array.from({ length: 6 }, (_, i) => 50 + i * 38);
        const dots = rings.map((radius, i) => {
          const a = r() * Math.PI * 2;
          return { x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a), s: 4 + (i % 3) * 3 };
        });
        return (
          <>
            <defs>
              <radialGradient id={`${uid}g`} cx="50%" cy="45%" r="75%">
                <stop offset="0" stopColor={c1} />
                <stop offset="1" stopColor={c0} />
              </radialGradient>
            </defs>
            <rect width={W} height={H} fill={`url(#${uid}g)`} />
            {rings.map((radius, i) => (
              <circle key={i} cx={cx} cy={cy} r={radius} fill="none" stroke={i % 2 ? '#fff' : c2} strokeOpacity={i % 2 ? 0.16 : 0.7} strokeWidth={i % 2 ? 1 : 2} />
            ))}
            <circle cx={cx} cy={cy} r={30} fill={c2} />
            {dots.map((d, i) => (
              <circle key={i} cx={d.x} cy={d.y} r={d.s} fill="#fff" />
            ))}
          </>
        );
      }
      case 'stripes':
      default: {
        const angle = -20 - r() * 20;
        const stripes = Array.from({ length: 14 }, (_, i) => i);
        return (
          <>
            <rect width={W} height={H} fill={c0} />
            <g transform={`rotate(${angle} 200 250)`}>
              {stripes.map((i) => (
                <rect key={i} x={-300 + i * 70} y={-200} width={i % 3 === 0 ? 38 : 16} height={900} fill={i % 2 ? c2 : c1} opacity={i % 3 === 0 ? 0.95 : 0.5} />
              ))}
            </g>
            <rect width={W} height={H} fill={c0} opacity={0.18} />
          </>
        );
      }
    }
  }, [poster.style, poster.seed, c0, c1, c2, uid]);

  return (
    <svg viewBox="0 0 400 500" preserveAspectRatio="xMidYMid slice" className={className} role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      {art}
    </svg>
  );
});

/** A representative colour for tinting UI around an event (ticket pass, hero fade). */
export function posterColors(poster: PosterSpec): { dark: string; mid: string; accent: string } {
  const [c0, c1, c2] = posterPalette(poster.palette);
  return { dark: c0, mid: c1, accent: c2 };
}
