import { useRef, useState } from 'react';
import { Check, ImagePlus, Shuffle, Trash2 } from 'lucide-react';
import { POSTER_PALETTES, POSTER_STYLES, type PosterPaletteId, type PosterStyle } from '../../shared/constants';
import type { PosterSpec } from '../../shared/types';
import { useApi } from '../app/context';
import { errorMessage } from '../api/client';
import { PosterArt } from '../components/event/PosterArt';
import { ApiImage } from '../components/event/EventImage';
import { Button } from '../components/ui/Button';
import { useToast } from '../components/ui/Overlays';
import { prepareImage } from '../lib/image';
import { cn } from '../lib/cn';

const STYLE_NAMES: Record<PosterStyle, string> = { aurora: 'Nordlys', rays: 'Stråler', grid: 'Rutenett', waves: 'Bølger', orbit: 'Bane', stripes: 'Striper' };

export function PalettePicker({ value, onChange, label = 'Farger' }: { value: PosterPaletteId; onChange: (v: PosterPaletteId) => void; label?: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2.5">
      {POSTER_PALETTES.map((p) => (
        <button
          key={p.id}
          type="button"
          role="radio"
          aria-checked={value === p.id}
          aria-label={p.label}
          title={p.label}
          onClick={() => onChange(p.id)}
          className={cn('relative h-11 w-11 rounded-full transition-transform active:scale-95', value === p.id && 'ring-[3px] ring-[var(--tint)] ring-offset-2 ring-offset-[var(--bg-grouped-2)]')}
          style={{ background: `linear-gradient(135deg, ${p.colors[1]} 0%, ${p.colors[0]} 60%, ${p.colors[2]} 100%)` }}
        >
          {value === p.id && <Check className="absolute inset-0 m-auto h-5 w-5 text-white" strokeWidth={3} aria-hidden="true" />}
        </button>
      ))}
    </div>
  );
}

export function PosterDesigner({ poster, onChange, title }: { poster: PosterSpec; onChange: (p: PosterSpec) => void; title: string }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row">
      <div className="relative mx-auto aspect-[4/5] w-44 shrink-0 overflow-hidden rounded-[18px] shadow-[var(--card-shadow)] sm:mx-0">
        <PosterArt poster={poster} className="absolute inset-0 h-full w-full" title={`Forhåndsvisning av plakat for ${title || 'arrangementet'}`} />
        <div className="absolute inset-x-0 bottom-0 bg-[linear-gradient(180deg,transparent,rgba(0,0,0,0.6))] p-3">
          <p className="display line-clamp-3 text-[1rem] leading-[1.05] text-white">{title || 'Tittel'}</p>
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <div>
          <p className="mb-2 text-subhead font-medium text-label-2">Mønster</p>
          <div role="radiogroup" aria-label="Mønster" className="flex flex-wrap gap-2">
            {POSTER_STYLES.map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={poster.style === s}
                onClick={() => onChange({ ...poster, style: s })}
                className={cn('h-9 rounded-full px-3.5 text-subhead font-semibold', poster.style === s ? 'bg-label text-bg' : 'bg-fill-3 text-label')}
              >
                {STYLE_NAMES[s]}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-2 text-subhead font-medium text-label-2">Farger</p>
          <PalettePicker value={poster.palette} onChange={(palette) => onChange({ ...poster, palette })} />
        </div>
        <Button variant="gray" size="sm" className="self-start" icon={<Shuffle className="h-4 w-4" />} onClick={() => onChange({ ...poster, seed: Math.floor(Math.random() * 1_000_000) })}>
          Lag ny variant
        </Button>
      </div>
    </div>
  );
}

/** Upload (or remove) an image; returns the stored image id. */
export function ImageUpload({ imageId, onChange, label, aspect = 'aspect-[4/5]' }: { imageId: string | null; onChange: (id: string | null) => void; label: string; aspect?: string }) {
  const api = useApi();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const prepared = await prepareImage(file);
      const res = await api.post<{ id: string; url: string }>('/images', prepared);
      onChange(res.id);
    } catch (err) {
      toast({ message: errorMessage(err), tone: 'error' });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <div className="flex items-center gap-4">
      <div className={cn('relative w-24 shrink-0 overflow-hidden rounded-[14px] bg-fill-3', aspect)}>
        {imageId ? <ApiImage src={`/api/images/${imageId}`} alt="" className="absolute inset-0 h-full w-full" /> : <ImagePlus className="absolute inset-0 m-auto h-7 w-7 text-label-3" aria-hidden="true" />}
      </div>
      <div className="flex flex-col gap-2">
        {/* The visible button is the control; the file input stays out of the tab order and the accessibility tree. */}
        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          aria-label={label}
          onChange={(e) => void pick(e.target.files?.[0])}
        />
        <Button size="sm" variant="tinted" loading={busy} onClick={() => input.current?.click()}>
          {imageId ? 'Bytt bilde' : label}
        </Button>
        {imageId && (
          <Button size="sm" variant="plain" icon={<Trash2 className="h-4 w-4" />} onClick={() => onChange(null)}>
            Fjern
          </Button>
        )}
        <p className="text-footnote text-label-2">JPG, PNG eller WebP. Bildet komprimeres på enheten.</p>
      </div>
    </div>
  );
}
