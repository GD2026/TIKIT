import { useState } from 'react';
import { Link } from 'react-router';
import { CalendarSearch } from 'lucide-react';
import { CATEGORIES } from '../../shared/constants';
import { useConfig, useHome, type HomeSection } from '../api/hooks';
import { useAuth } from '../app/auth';
import { Page } from '../components/layout/Page';
import { Rail, RailItem, SectionHeader } from '../components/layout/Rails';
import { CountdownCard, HeroCard, RowCard, TileCard } from '../components/event/EventCards';
import { CityButton, CityPickerSheet, useCity } from '../components/event/CityPicker';
import { EmptyState, Skeleton } from '../components/ui/Feedback';
import { QueryError } from '../components/ui/States';
import { Avatar } from '../components/ui/Avatar';
import { Button } from '../components/ui/Button';
import { DemoButton } from '../demo/DemoPanel';
import { isDemoBuild } from '../lib/device';
import { cn } from '../lib/cn';

function seeAllLink(section: HomeSection, city: string | null): string | undefined {
  if (section.id === 'all' && section.events.length >= 40) return city ? `/sok?by=${encodeURIComponent(city)}` : '/sok';
  return undefined;
}

function HomeSectionView({ section, city }: { section: HomeSection; city: string | null }) {
  const headingId = `seksjon-${section.id}`;
  if (section.events.length === 0) return null;
  if (section.style === 'hero') {
    return (
      <section aria-label={section.title} className="mb-6">
        <Rail label={section.title} className="gap-3.5">
          {section.events.map((e) => (
            <RailItem key={e.id} className="w-[calc(100%-36px)] sm:w-[72%] lg:w-[calc(50%-8px)]">
              <HeroCard event={e} />
            </RailItem>
          ))}
        </Rail>
      </section>
    );
  }
  if (section.style === 'countdown') {
    return (
      <section aria-labelledby={headingId} className="mb-6">
        <SectionHeader id={headingId} title={section.title} subtitle={section.subtitle} />
        <Rail label={section.title}>
          {section.events.map((e) => (
            <RailItem key={e.id}>
              <CountdownCard event={e} />
            </RailItem>
          ))}
        </Rail>
      </section>
    );
  }
  if (section.style === 'row') {
    return (
      <section aria-labelledby={headingId} className="mb-6">
        <SectionHeader id={headingId} title={section.title} subtitle={section.subtitle} to={seeAllLink(section, city)} />
        <Rail label={section.title}>
          {section.events.map((e) => (
            <RailItem key={e.id}>
              <TileCard event={e} />
            </RailItem>
          ))}
        </Rail>
      </section>
    );
  }
  return (
    <section aria-labelledby={headingId} className="mb-7">
      <SectionHeader id={headingId} title={section.title} subtitle={section.subtitle} to={seeAllLink(section, city)} />
      <div className="mx-4 overflow-hidden rounded-md bg-grouped-2 lg:grid lg:grid-cols-2 lg:gap-3 lg:overflow-visible lg:rounded-none lg:bg-transparent">
        {section.events.map((e, i) => (
          <RowCard key={e.id} event={e} className={cn(i > 0 && 'hairline-t', 'lg:rounded-md lg:bg-grouped-2 lg:shadow-none')} />
        ))}
      </div>
    </section>
  );
}

function HomeSkeleton() {
  return (
    <div aria-busy="true" aria-label="Laster arrangementer">
      <div className="flex gap-3.5 overflow-hidden px-4 pb-6">
        <Skeleton className="aspect-[4/5] w-[calc(100%-36px)] shrink-0 rounded-[26px] sm:aspect-[16/11] sm:w-[72%]" />
        <Skeleton className="aspect-[4/5] w-[calc(100%-36px)] shrink-0 rounded-[26px] sm:aspect-[16/11] sm:w-[72%]" />
      </div>
      {[0, 1].map((r) => (
        <div key={r} className="mb-6">
          <Skeleton className="mx-4 mb-3 h-6 w-40" />
          <div className="flex gap-3 overflow-hidden px-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="w-[168px] shrink-0">
                <Skeleton className="aspect-[4/5] w-full rounded-[18px]" />
                <Skeleton className="mt-2 h-4 w-4/5" />
                <Skeleton className="mt-1.5 h-3.5 w-1/2" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Discover() {
  const [city, setCity] = useCity();
  const [picker, setPicker] = useState(false);
  const home = useHome(city);
  const { me, loading, openLogin } = useAuth();
  const config = useConfig().data;
  const showDemo = isDemoBuild || !!config?.demoMode;

  const accessory = (
    <div className="flex items-center gap-2 pb-1 lg:hidden">
      {showDemo && <DemoButton />}
      {me ? (
        <Link to="/profil" aria-label={`Profil – ${me.name}`} className="press relative rounded-full no-underline">
          <Avatar name={me.name} size={36} />
          {me.unreadNotifications > 0 && <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full bg-red-fill ring-2 ring-[var(--bg-grouped)]" aria-hidden="true" />}
        </Link>
      ) : (
        !loading && (
          <Button size="sm" onClick={() => openLogin({})}>
            Logg inn
          </Button>
        )
      )}
    </div>
  );

  const sections = home.data?.sections ?? [];
  const hasEvents = sections.some((s) => s.events.length > 0);

  return (
    <Page title="Utforsk" large wide subtitle={<CityButton city={city} onClick={() => setPicker(true)} />} largeAccessory={accessory}>
      <nav aria-label="Kategorier" className="mb-5">
        <div className="flex flex-wrap gap-2 px-4 py-1">
          {CATEGORIES.filter((c) => c.id !== 'annet').map((c) => (
            <Link
              key={c.id}
              to={`/sok?kategori=${c.id}`}
              className="press relative inline-flex h-9 shrink-0 items-center rounded-full bg-fill-3 px-4 text-subhead font-semibold text-label no-underline hover:bg-fill-2 before:absolute before:inset-x-0 before:-inset-y-1 before:content-['']"
            >
              {c.label}
            </Link>
          ))}
        </div>
      </nav>

      {home.isLoading && <HomeSkeleton />}
      {home.isError && <QueryError error={home.error} onRetry={() => void home.refetch()} />}
      {home.data && !hasEvents && (
        <EmptyState
          icon={<CalendarSearch />}
          title={city ? `Ingen arrangementer i ${city} ennå` : 'Ingen arrangementer ennå'}
          message={city ? 'Se hva som skjer i resten av landet.' : 'Når arrangører publiserer billetter, dukker de opp her.'}
          action={city ? <Button onClick={() => setCity(null)}>Vis hele Norge</Button> : undefined}
        />
      )}
      {sections.map((s) => (
        <HomeSectionView key={s.id} section={s} city={city} />
      ))}

      <CityPickerSheet open={picker} onClose={() => setPicker(false)} value={city} onChange={setCity} />
    </Page>
  );
}
