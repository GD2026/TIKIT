import { Hono } from 'hono';
import { z } from 'zod';
import { AppError } from '../../shared/errors';
import { CATEGORY_IDS, LIMITS } from '../../shared/constants';
import { imageUploadSchema, reportCreateSchema, unlockSchema } from '../../shared/schemas';
import type { AppConfig, PaymentMethodId, ProviderId } from '../../shared/types';
import { body, limit, parse, requireUser, type AppEnv } from '../middleware/core';
import { getSettings } from '../services/common';
import {
  getEventDetail,
  getHome,
  getPublicSeatMap,
  listEvents,
  setFavorite,
  setSaleAlert,
  unlockTicketTypes,
} from '../services/events';
import { getOrganizerPublic, setFollow } from '../services/organizers';
import { getImage, uploadImage } from '../services/misc';
import { blockedOrganizerIds, createReport, setBlock } from '../services/moderation';
import { listResaleOffers } from '../services/tickets';
import { joinWaitlist, leaveWaitlist } from '../services/waitlist';
import { getQueueStatus, joinQueue, leaveQueue } from '../services/queue';
import type { Deps } from '../context';

const eventQuerySchema = z.object({
  q: z.string().trim().max(80).optional(),
  city: z.string().trim().max(60).optional(),
  category: z.enum(CATEGORY_IDS).optional(),
  when: z.enum(['today', 'weekend', 'week', 'month']).optional(),
  sort: z.enum(['date', 'popular']).optional(),
  organizer: z.string().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export async function buildAppConfig(deps: Deps): Promise<AppConfig> {
  const settings = await deps.store.read((tx) => getSettings(tx, deps));
  const providers: AppConfig['providers'] = (['vipps', 'google', 'apple'] as ProviderId[])
    .map((id) => ({ id, demo: !deps.oauth[id] }))
    .filter((p) => !p.demo || deps.config.demoMode);
  const paymentMethods: AppConfig['paymentMethods'] = (['vipps', 'card'] as PaymentMethodId[])
    .filter((m) => !!deps.payments[m])
    .map((id) => ({ id, demo: deps.payments[id]!.provider === 'demo' }));
  return {
    demoMode: deps.config.demoMode,
    appName: 'TIKIT',
    publicUrl: deps.config.publicUrl,
    providers,
    paymentMethods,
    wallet: { apple: !!deps.wallet?.apple, google: !!deps.wallet?.google },
    fees: { fixedOre: settings.feeFixedOre, percentBp: settings.feePercentBp, maxOre: settings.feeMaxOre },
    serverTime: deps.clock().toISOString(),
    qrStepSeconds: LIMITS.qrStepSeconds,
    operator: { name: deps.config.operatorName ?? 'TIKIT', orgNumber: deps.config.operatorOrgNumber ?? null, supportEmail: deps.config.supportEmail ?? null },
    appleNative: !!deps.appleNative?.nativeSignIn,
    reviewLogin: !!deps.config.review,
  };
}

export function publicRoutes(deps: Deps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get('/config', async (c) => c.json(await buildAppConfig(deps)));

  app.get('/home', async (c) => {
    // An explicit (possibly empty) ?city= wins; otherwise fall back to the city on the profile.
    const raw = c.req.query('city');
    const city = raw !== undefined ? raw.trim().slice(0, 60) || null : c.get('user')?.city || null;
    const blocked = await blockedOrganizerIds(deps, c.get('user')?.id);
    return c.json({ sections: await getHome(deps, c.get('user'), city, blocked), city });
  });

  app.get('/events', async (c) => {
    const q = parse(eventQuerySchema, c.req.query());
    let organizerId: string | undefined;
    if (q.organizer) {
      const org = await getOrganizerPublic(deps, q.organizer).catch(() => null);
      if (!org) return c.json({ events: [] });
      organizerId = org.id;
    }
    // An organizer page lists its own events even when the viewer has hidden that organizer elsewhere.
    const blocked = organizerId ? undefined : await blockedOrganizerIds(deps, c.get('user')?.id);
    const events = await listEvents(deps, {
      ...(blocked ? { excludeOrganizerIds: blocked } : {}),
      ...(q.q ? { q: q.q } : {}),
      ...(q.city ? { city: q.city } : {}),
      ...(q.category ? { category: q.category } : {}),
      ...(q.when ? { when: q.when } : {}),
      ...(q.sort ? { sort: q.sort } : {}),
      ...(organizerId ? { organizerId } : {}),
      ...(q.limit ? { limit: q.limit } : {}),
    });
    return c.json({ events });
  });

  app.get('/events/:slug', async (c) => {
    const unlock = c.req.header('x-tikit-unlock') ?? null;
    return c.json(await getEventDetail(deps, c.req.param('slug'), c.get('user'), unlock));
  });

  app.post('/events/:id/unlock', limit('unlock', 12, 10 * 60_000), async (c) => {
    const { code } = await body(c, unlockSchema);
    const existing = c.req.header('x-tikit-unlock') ?? null;
    return c.json(await unlockTicketTypes(deps, c.req.param('id'), code, existing));
  });

  app.get('/events/:id/seatmap', async (c) => c.json(await getPublicSeatMap(deps, c.req.param('id'), c.req.query('order') ?? null)));

  app.get('/events/:id/resale', async (c) => c.json({ offers: await listResaleOffers(deps, c.req.param('id'), c.get('user')) }));

  app.post('/events/:id/favorite', async (c) => {
    await setFavorite(deps, requireUser(c).id, c.req.param('id'), true);
    return c.json({ ok: true });
  });
  app.delete('/events/:id/favorite', async (c) => {
    await setFavorite(deps, requireUser(c).id, c.req.param('id'), false);
    return c.json({ ok: true });
  });
  app.post('/events/:id/alert', async (c) => {
    await setSaleAlert(deps, requireUser(c).id, c.req.param('id'), true);
    return c.json({ ok: true });
  });
  app.delete('/events/:id/alert', async (c) => {
    await setSaleAlert(deps, requireUser(c).id, c.req.param('id'), false);
    return c.json({ ok: true });
  });
  app.post('/events/:id/waitlist', async (c) => {
    await joinWaitlist(deps, requireUser(c).id, c.req.param('id'));
    return c.json({ ok: true });
  });
  app.delete('/events/:id/waitlist', async (c) => {
    await leaveWaitlist(deps, requireUser(c).id, c.req.param('id'));
    return c.json({ ok: true });
  });

  app.post('/events/:id/queue', limit('queue-join', 20, 60_000, 'user'), async (c) => c.json(await joinQueue(deps, c.req.param('id'), requireUser(c).id)));
  app.get('/events/:id/queue', limit('queue-poll', 120, 60_000, 'user'), async (c) => {
    const status = await getQueueStatus(deps, c.req.param('id'), requireUser(c).id);
    return c.json({ status });
  });
  app.delete('/events/:id/queue', async (c) => {
    await leaveQueue(deps, c.req.param('id'), requireUser(c).id);
    return c.json({ ok: true });
  });

  app.get('/organizers/:slug', async (c) => {
    const organizer = await getOrganizerPublic(deps, c.req.param('slug'));
    const events = await listEvents(deps, { organizerId: organizer.id });
    const user = c.get('user');
    const [following, blocked] = user
      ? await deps.store.read(async (tx) => [!!(await tx.get('follows', `${user.id}:${organizer.id}`)), !!(await tx.get('blocks', `${user.id}:${organizer.id}`))])
      : [false, false];
    return c.json({ organizer, events, following, blocked });
  });
  app.post('/organizers/:id/follow', async (c) => {
    await setFollow(deps, requireUser(c).id, c.req.param('id'), true);
    return c.json({ ok: true });
  });
  app.delete('/organizers/:id/follow', async (c) => {
    await setFollow(deps, requireUser(c).id, c.req.param('id'), false);
    return c.json({ ok: true });
  });

  // ── Moderation: report content, hide an organizer (App Store Review Guideline 1.2) ────────────
  app.post('/reports', limit('report', 10, 60 * 60_000), async (c) => {
    const report = await createReport(deps, c.get('user'), await body(c, reportCreateSchema));
    return c.json({ ok: true, id: report.id }, 201);
  });

  app.post('/organizers/:id/block', async (c) => {
    await setBlock(deps, requireUser(c).id, c.req.param('id'), true);
    return c.json({ ok: true });
  });

  app.delete('/organizers/:id/block', async (c) => {
    await setBlock(deps, requireUser(c).id, c.req.param('id'), false);
    return c.json({ ok: true });
  });

  app.post('/images', limit('image-upload', 30, 60 * 60_000, 'user'), async (c) => {
    const user = requireUser(c);
    const input = await body(c, imageUploadSchema);
    return c.json(await uploadImage(deps, user, input));
  });

  app.get('/images/:id', async (c) => {
    const img = await getImage(deps, c.req.param('id'));
    if (!img) throw new AppError('not_found');
    return new Response(img.bytes as unknown as ConstructorParameters<typeof Response>[0], {
      headers: {
        'Content-Type': img.mime,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
        // Event images are public; the iOS app (capacitor://localhost) loads them cross-origin.
        'Cross-Origin-Resource-Policy': 'cross-origin',
      },
    });
  });

  return app;
}
