import { Hono } from 'hono';
import { z } from 'zod';
import { organizerReviewSchema, payoutCreateSchema, platformSettingsSchema, reportResolveSchema } from '../../shared/schemas';
import { body, requireUser, type AppEnv } from '../middleware/core';
import {
  adminEvents,
  adminOrganizers,
  adminOverview,
  adminUsers,
  getPlatformSettings,
  recordPayout,
  reviewOrganizer,
  setFeatured,
  setUserBanned,
  updatePlatformSettings,
} from '../services/admin';
import { listReports, resolveReport, restoreEvent } from '../services/moderation';
import type { Deps } from '../context';

export function adminRoutes(deps: Deps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.get('/overview', async (c) => c.json(await adminOverview(deps, requireUser(c))));
  app.get('/organizers', async (c) => {
    const status = c.req.query('status');
    const valid = status === 'pending' || status === 'approved' || status === 'rejected' || status === 'suspended' ? status : null;
    return c.json({ organizers: await adminOrganizers(deps, requireUser(c), valid) });
  });
  app.post('/organizers/:id/review', async (c) => c.json(await reviewOrganizer(deps, requireUser(c), c.req.param('id'), await body(c, organizerReviewSchema))));
  app.post('/organizers/:id/payouts', async (c) => c.json(await recordPayout(deps, requireUser(c), c.req.param('id'), await body(c, payoutCreateSchema)), 201));
  app.get('/events', async (c) => c.json({ events: await adminEvents(deps, requireUser(c), c.req.query('q')?.slice(0, 80) ?? null) }));
  app.post('/events/:id/feature', async (c) => {
    const { featured } = await body(c, z.object({ featured: z.boolean() }).strict());
    await setFeatured(deps, requireUser(c), c.req.param('id'), featured);
    return c.json({ ok: true });
  });
  app.get('/users', async (c) => c.json({ users: await adminUsers(deps, requireUser(c), c.req.query('q')?.slice(0, 80) ?? null) }));
  app.post('/users/:id/ban', async (c) => {
    const { banned } = await body(c, z.object({ banned: z.boolean() }).strict());
    await setUserBanned(deps, requireUser(c), c.req.param('id'), banned);
    return c.json({ ok: true });
  });
  // ── Moderation queue (App Store Review Guideline 1.2) ────────────────────
  app.get('/reports', async (c) => {
    const status = c.req.query('status');
    const valid = status === 'open' || status === 'resolved' || status === 'dismissed' ? status : null;
    return c.json({ reports: await listReports(deps, requireUser(c), valid) });
  });
  app.post('/reports/:id/resolve', async (c) => {
    await resolveReport(deps, requireUser(c), c.req.param('id'), await body(c, reportResolveSchema));
    return c.json({ ok: true });
  });
  app.post('/events/:id/restore', async (c) => {
    await restoreEvent(deps, requireUser(c), c.req.param('id'));
    return c.json({ ok: true });
  });
  app.get('/settings', async (c) => c.json(await getPlatformSettings(deps, requireUser(c))));
  app.put('/settings', async (c) => c.json(await updatePlatformSettings(deps, requireUser(c), await body(c, platformSettingsSchema))));
  return app;
}
