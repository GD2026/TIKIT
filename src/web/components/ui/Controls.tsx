import { useId, type ReactNode } from 'react';
import { Minus, Plus } from 'lucide-react';
import { cn } from '../../lib/cn';
import { haptic } from '../../lib/haptics';

export function Switch({ id, checked, onChange, disabled, label }: { id?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string }) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => {
        haptic('light');
        onChange(!checked);
      }}
      className={cn(
        'relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors duration-200 disabled:cursor-not-allowed',
        checked ? 'bg-green-fill' : 'bg-fill',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'absolute left-0 top-[2px] h-[27px] w-[27px] rounded-full bg-white shadow-[0_3px_8px_rgba(0,0,0,0.15),0_1px_1px_rgba(0,0,0,0.16)] transition-transform duration-200 [transition-timing-function:var(--spring)]',
          checked ? 'translate-x-[22px]' : 'translate-x-[2px]',
        )}
      />
    </button>
  );
}

export interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
  badge?: number;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  className,
  label,
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
  label: string;
}) {
  const idx = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div role="tablist" aria-label={label} className={cn('relative grid h-9 rounded-[10px] bg-fill-3 p-[2px]', className)} style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      <span
        aria-hidden="true"
        className="absolute bottom-[2px] top-[2px] rounded-[8px] bg-[var(--segment)] shadow-[0_3px_8px_rgba(0,0,0,0.12),0_3px_1px_rgba(0,0,0,0.04)] transition-transform duration-300 [transition-timing-function:var(--ease-out)]"
        style={{ width: `calc((100% - 4px) / ${options.length})`, transform: `translateX(${idx * 100}%)`, left: 2 }}
      />
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          onClick={() => {
            if (o.value !== value) haptic('light');
            onChange(o.value);
          }}
          className={cn(
            // The pseudo-element stretches the hit area to 44 px while the control stays 36 px tall.
            "relative z-10 flex min-w-0 items-center justify-center gap-1.5 px-1.5 before:absolute before:inset-x-0 before:-inset-y-1 before:content-['']",
            // Four or more segments use the 13 px size of UISegmentedControl so labels like "Suspendert" fit on phones.
            options.length >= 4 ? 'text-footnote' : 'text-subhead',
            o.value === value ? 'font-semibold' : 'font-medium text-label',
          )}
        >
          <span className="truncate">{o.label}</span>
          {!!o.badge && <span className="rounded-full bg-[var(--badge)] px-1.5 text-caption2 font-bold text-white">{o.badge}</span>}
        </button>
      ))}
    </div>
  );
}

export function Stepper({
  value,
  min = 0,
  max,
  onChange,
  label,
  disabled,
}: {
  value: number;
  min?: number;
  max: number;
  onChange: (v: number) => void;
  label: string;
  disabled?: boolean;
}) {
  const id = useId();
  const canDec = !disabled && value > min;
  const canInc = !disabled && value < max;
  return (
    <div className="flex items-center gap-1" role="group" aria-labelledby={id}>
      <span id={id} className="sr-only">
        {label}
      </span>
      <button
        type="button"
        aria-label={`Færre: ${label}`}
        disabled={!canDec}
        onClick={() => {
          haptic('light');
          onChange(value - 1);
        }}
        className="press relative flex h-9 w-9 items-center justify-center rounded-full bg-fill-3 text-label before:absolute before:-inset-1 before:content-[''] disabled:opacity-30"
      >
        <Minus className="h-4 w-4" strokeWidth={2.75} />
      </button>
      <output aria-live="polite" className="w-8 text-center text-headline font-semibold tabular">
        {value}
      </output>
      <button
        type="button"
        aria-label={`Flere: ${label}`}
        disabled={!canInc}
        onClick={() => {
          haptic('light');
          onChange(value + 1);
        }}
        className="press relative flex h-9 w-9 items-center justify-center rounded-full bg-tint-fill text-on-tint before:absolute before:-inset-1 before:content-[''] disabled:bg-fill-3 disabled:text-label disabled:opacity-30"
      >
        <Plus className="h-4 w-4" strokeWidth={2.75} />
      </button>
    </div>
  );
}
