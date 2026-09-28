import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Table2, BarChart3 } from 'lucide-react';
import { cn } from '../../lib/cn';

// ── Stat tile ────────────────────────────────────────────────────────────────

export function StatTile({ label, value, caption, className }: { label: string; value: ReactNode; caption?: ReactNode; className?: string }) {
  // Long figures ("1 154 426 kr") step down in size so they stay on one line in a half-width phone tile
  // (≈140 px of text) instead of breaking inside the number.
  const len = typeof value === 'string' || typeof value === 'number' ? String(value).length : 0;
  const size = len >= 12 ? 'text-headline' : len >= 10 ? 'text-title3' : 'text-title2';
  return (
    <div className={cn('rounded-md bg-grouped-2 px-4 py-3.5', className)}>
      <p className="text-footnote text-label-2">{label}</p>
      <p className={cn('mt-1 font-bold leading-tight [overflow-wrap:break-word] lg:text-title2', size)}>{value}</p>
      {caption && <p className="mt-0.5 text-footnote text-label-2">{caption}</p>}
    </div>
  );
}

// ── Meter (value against a limit) ────────────────────────────────────────────

export function Meter({ value, max, label, className, showText = true }: { value: number; max: number; label: string; className?: string; showText?: boolean }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div className={className}>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={`${value} av ${max}`}
        className="h-2 w-full overflow-hidden rounded-full bg-tint-soft"
      >
        <div className="h-full rounded-full bg-[var(--chart-series)] transition-[width] duration-500" style={{ width: `${pct}%` }} />
      </div>
      {showText && (
        <p className="mt-1 text-footnote text-label-2 tabular">
          {value} av {max} · {Math.round(pct)} %
        </p>
      )}
    </div>
  );
}

// ── Column chart (one series over time) ─────────────────────────────────────

export interface ColumnDatum {
  key: string;
  /** Short axis label, e.g. "3. okt". */
  label: string;
  /** Full label for tooltip and table, e.g. "fredag 3. oktober". */
  fullLabel: string;
  value: number;
}

function niceMax(max: number): number {
  if (max <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(max)));
  const f = max / exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * exp;
}

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => setW(Math.round(entries[0]!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/**
 * Accessible column chart: thin columns with rounded data-ends, hairline grid, hover/focus tooltip
 * (arrow keys move between columns) and a table view twin. Colour comes from --chart-series.
 */
export function ColumnChart({
  data,
  format,
  axisFormat,
  title,
  height = 168,
  emptyText = 'Ingen data i perioden',
}: {
  data: ColumnDatum[];
  format: (v: number) => string;
  axisFormat?: (v: number) => string;
  title: string;
  height?: number;
  emptyText?: string;
}) {
  const [wrapRef, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const tableId = useId();
  const max = useMemo(() => niceMax(Math.max(0, ...data.map((d) => d.value))), [data]);
  const allZero = data.every((d) => d.value === 0);

  const axisW = 44;
  const axisBand = 22;
  const plotW = Math.max(0, width - axisW);
  const band = data.length > 0 ? plotW / data.length : 0;
  const barW = Math.max(2, Math.min(24, band - 2));
  const ticks = [0, max / 2, max];
  // Room for ~"23. sep" (≈44 px at 11 px) plus a clear gap between neighbours.
  const labelEvery = Math.max(1, Math.ceil(data.length / Math.max(1, Math.floor(plotW / 68))));
  const fmtAxis = axisFormat ?? format;
  const y = (v: number) => height - (v / max) * (height - 8);

  const onMove = (clientX: number) => {
    const el = wrapRef.current;
    if (!el || band <= 0) return;
    const x = clientX - el.getBoundingClientRect().left - axisW;
    const i = Math.floor(x / band);
    setActive(i >= 0 && i < data.length ? i : null);
  };

  const activeDatum = active !== null ? data[active] : undefined;
  const tipLeft = active !== null ? axisW + active * band + band / 2 : 0;

  return (
    <figure className="m-0">
      <div className="mb-2 flex items-center justify-between gap-3">
        <figcaption className="text-headline font-semibold">{title}</figcaption>
        <button
          type="button"
          onClick={() => setTable((v) => !v)}
          aria-expanded={table}
          aria-controls={tableId}
          className="-my-1 inline-flex h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-subhead font-medium text-tint hover:bg-fill-4"
        >
          {table ? <BarChart3 className="h-4 w-4" aria-hidden="true" /> : <Table2 className="h-4 w-4" aria-hidden="true" />}
          {table ? 'Vis diagram' : 'Vis tabell'}
        </button>
      </div>
      {table ? (
        <div id={tableId} className="max-h-72 overflow-auto rounded-[12px] bg-fill-4">
          <table className="w-full text-subhead">
            <thead>
              <tr className="text-left text-footnote text-label-2">
                <th scope="col" className="px-3 py-2 font-medium">
                  Dato
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Verdi
                </th>
              </tr>
            </thead>
            <tbody className="tabular">
              {data.map((d) => (
                <tr key={d.key} className="hairline-t">
                  <td className="px-3 py-1.5">{d.fullLabel}</td>
                  <td className="px-3 py-1.5 text-right">{format(d.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div
          ref={wrapRef}
          className="relative w-full select-none outline-none"
          style={{ height: height + axisBand }}
          tabIndex={0}
          role="img"
          aria-label={`${title}. ${data.length} dager. Høyeste verdi ${format(Math.max(0, ...data.map((d) => d.value)))}. Bruk piltastene for å lese hver dag, eller velg Vis tabell.`}
          onPointerMove={(e) => onMove(e.clientX)}
          onPointerLeave={() => setActive(null)}
          onFocus={() => setActive((a) => a ?? data.length - 1)}
          onBlur={() => setActive(null)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') {
              e.preventDefault();
              setActive((a) => Math.max(0, (a ?? data.length) - 1));
            } else if (e.key === 'ArrowRight') {
              e.preventDefault();
              setActive((a) => Math.min(data.length - 1, (a ?? -1) + 1));
            } else if (e.key === 'Escape') setActive(null);
          }}
        >
          {width > 0 && (
            <svg width={width} height={height + axisBand} aria-hidden="true" className="block overflow-visible">
              {ticks.map((t) => (
                <g key={t}>
                  <line x1={axisW} x2={width} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'var(--chart-baseline)' : 'var(--chart-grid)'} strokeWidth={1} shapeRendering="crispEdges" />
                  <text x={axisW - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize="11" fill="var(--label-2)" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {fmtAxis(t)}
                  </text>
                </g>
              ))}
              {data.map((d, i) => {
                const h = (d.value / max) * (height - 8);
                const x = axisW + i * band + (band - barW) / 2;
                if (h <= 0) return null;
                const r = Math.min(4, barW / 2, h);
                const top = height - h;
                const path = `M${x},${height} L${x},${top + r} Q${x},${top} ${x + r},${top} L${x + barW - r},${top} Q${x + barW},${top} ${x + barW},${top + r} L${x + barW},${height} Z`;
                return <path key={d.key} d={path} fill="var(--chart-series)" opacity={active === null || active === i ? 1 : 0.45} />;
              })}
              {data.map((d, i) => {
                // Anchor labels on the latest day and step backwards, so "today" is always labelled.
                if ((data.length - 1 - i) % labelEvery !== 0) return null;
                const cx = axisW + i * band + band / 2;
                // Labels near the edges are aligned to the edge instead of being pushed inwards,
                // which would crowd them into their neighbour.
                const anchor = cx > width - 24 ? 'end' : cx < axisW + 24 ? 'start' : 'middle';
                const x = anchor === 'end' ? width : anchor === 'start' ? axisW : cx;
                return (
                  <text key={d.key} x={x} y={height + 15} textAnchor={anchor} fontSize="11" fill="var(--label-2)">
                    {d.label}
                  </text>
                );
              })}
              {active !== null && <line x1={tipLeft} x2={tipLeft} y1={4} y2={height} stroke="var(--label-3)" strokeWidth={1} shapeRendering="crispEdges" />}
            </svg>
          )}
          {allZero && <p className="absolute inset-x-0 top-1/3 text-center text-subhead text-label-2">{emptyText}</p>}
          {activeDatum && (
            <div
              className="glass pointer-events-none absolute top-0 z-10 -translate-x-1/2 whitespace-nowrap rounded-[12px] px-3 py-2"
              style={{ left: Math.min(Math.max(tipLeft, 70), Math.max(70, width - 70)), background: 'var(--glass-bg-strong)' }}
              role="status"
              aria-live="polite"
            >
              <p className="text-headline font-semibold tabular">{format(activeDatum.value)}</p>
              <p className="text-footnote text-label-2">{activeDatum.fullLabel}</p>
            </div>
          )}
        </div>
      )}
    </figure>
  );
}

/** Horizontal bars for a handful of named categories (one series, so no legend – the title names it). */
export function BarList({ rows, format, title }: { rows: { key: string; label: string; value: number; max?: number; caption?: string }[]; format: (v: number) => string; title: string }) {
  const top = Math.max(1, ...rows.map((r) => r.max ?? r.value));
  return (
    <figure className="m-0">
      <figcaption className="mb-3 text-headline font-semibold">{title}</figcaption>
      <ul className="flex flex-col gap-3.5">
        {rows.map((r) => {
          const scaleMax = r.max ?? top;
          const pct = scaleMax > 0 ? Math.min(100, (r.value / scaleMax) * 100) : 0;
          return (
            <li key={r.key}>
              <div className="mb-1 flex items-baseline justify-between gap-3 text-subhead">
                <span className="truncate font-medium">{r.label}</span>
                <span className="shrink-0 text-label-2 tabular">{format(r.value)}</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-tint-soft" aria-hidden="true">
                <div className="h-full rounded-full bg-[var(--chart-series)]" style={{ width: `${pct}%` }} />
              </div>
              {r.caption && <p className="mt-1 text-footnote text-label-2 tabular">{r.caption}</p>}
            </li>
          );
        })}
      </ul>
    </figure>
  );
}
