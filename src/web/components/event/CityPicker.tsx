import { useMemo, useState } from 'react';
import { Check, MapPin } from 'lucide-react';
import { CITIES } from '../../../shared/constants';
import { useMe } from '../../api/hooks';
import { safeStorage } from '../../lib/storage';
import { Sheet } from '../ui/Sheet';
import { SearchField } from '../ui/Field';
import { cn } from '../../lib/cn';

const KEY = 'tikit-city';

/** The city the person browses in: their own choice on this device, else the city on their profile. */
export function useCity(): [string | null, (city: string | null) => void] {
  const me = useMe().data?.me ?? null;
  const [local, setLocal] = useState<string | null | undefined>(() => {
    const v = safeStorage.get(KEY);
    return v === null ? undefined : v === '' ? null : v;
  });
  const set = (city: string | null) => {
    setLocal(city);
    safeStorage.set(KEY, city ?? '');
  };
  return [local === undefined ? (me?.city ?? null) : local, set];
}

export function CityButton({ city, onClick, className }: { city: string | null; onClick: () => void; className?: string }) {
  return (
    <button type="button" onClick={onClick} className={cn('press -ml-1 inline-flex h-11 items-center gap-1 rounded-full px-1 text-subhead font-semibold text-tint', className)} aria-haspopup="dialog">
      <MapPin className="h-4 w-4" aria-hidden="true" />
      {city ?? 'Hele Norge'}
      <svg aria-hidden="true" viewBox="0 0 12 8" className="ml-0.5 h-2 w-2.5">
        <path d="M1 1.5l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

export function CityPickerSheet({ open, onClose, value, onChange }: { open: boolean; onClose: () => void; value: string | null; onChange: (city: string | null) => void }) {
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? CITIES.filter((c) => c.toLowerCase().includes(needle)) : [...CITIES];
  }, [q]);
  const choose = (c: string | null) => {
    onChange(c);
    setQ('');
    onClose();
  };
  return (
    <Sheet open={open} onClose={onClose} title="Velg by" size="large">
      <SearchField value={q} onChange={setQ} placeholder="Søk etter by" className="mb-3" label="Søk etter by" />
      <div className="overflow-hidden rounded-md bg-grouped-2">
        {!q && <CityRow label="Hele Norge" selected={value === null} onClick={() => choose(null)} />}
        {list.map((c) => (
          <CityRow key={c} label={c} selected={value === c} onClick={() => choose(c)} />
        ))}
        {list.length === 0 && <p className="px-4 py-6 text-center text-subhead text-label-2">Ingen byer passer søket.</p>}
      </div>
    </Sheet>
  );
}

function CityRow({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={selected} className="flex min-h-11 w-full items-center gap-3 px-4 text-left transition-colors hover:bg-fill-4 active:bg-fill-3 [&+&]:hairline-t">
      <span className="flex-1 py-[11px] text-body">{label}</span>
      {selected && <Check className="h-5 w-5 text-tint" aria-hidden="true" />}
    </button>
  );
}
