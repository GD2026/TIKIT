import { Hono } from 'hono';
import { deleteCookie } from 'hono/cookie';
import { z } from 'zod';
import { AppError } from '../../shared/errors';
import { profileUpdateSchema } from '../../shared/schemas';
import type { ProviderId, ScannerMe } from '../../shared/types';
import { SESSION_COOKIE, body, requireUser, type AppEnv } from '../middleware/core';
import { deleteAccount, exportUserData, getMe, unlinkIdentity, updateProfile } from '../services/users';
import { listFavorites } from '../services/events';
import { listMyOrders } from '../services/orders';
import { listNotifications, markNotificationsRead } from '../services/misc';
import { listBlocked } from '../services/moderation';
import type { Deps } from '../context';

export function meRoutes(deps: Deps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get('/', async (c) => {
    const session = c.get('session');
    const user = c.get('user');
    if (session?.kind === 'scanner' && session.scanner) {
      const event = await deps.store.read((tx) => tx.get('events', session.scanner!.eventId));
      const scanner: ScannerMe = {
        kind: 'scanner',
        eventId: session.scanner.eventId,
        organizerId: session.scanner.organizerId,
        label: session.scanner.label,
        eventTitle: event?.title ?? '',
      };
      return c.json({ me: null, scanner });
    }
    if (!user) return c.json({ me: null, scanner: null });
    return c.json({ me: await getMe(deps, user.id), scanner: null });
  });

  app.get('/blocked', async (c) => c.json({ organizers: await listBlocked(deps, requireUser(c).id) }));

  app.patch('/', async (c) => {
    const user = requireUser(c);
    await updateProfile(deps, user.id, await body(c, profileUpdateSchema));
    return c.json({ me: await getMe(deps, user.id) });
  });

  app.delete('/', async (c) => {
    const user = requireUser(c);
    await deleteAccount(deps, user.id);
    deleteCookie(c, SESSION_COOKIE, { path: '/', secure: deps.config.cookieSecure });
    return c.json({ ok: true });
  });

  app.get('/export', async (c) => {
    const user = requireUser(c);
    const data = await exportUserData(deps, user.id);
    c.header('Content-Disposition', 'attachment; filename="tikit-mine-data.json"');
    return c.json(data);
  });

  app.delete('/identities/:provider', async (c) => {
    const user = requireUser(c);
    const provider = c.req.param('provider') as ProviderId;
    if (!['vipps', 'google', 'apple'].includes(provider)) throw new AppError('not_found');
    await unlinkIdentity(deps, user.id, provider);
    return c.json({ me: await getMe(deps, user.id) });
  });

  app.get('/orders', async (c) => c.json({ orders: await listMyOrders(deps, requireUser(c)) }));
  app.get('/favorites', async (c) => c.json({ events: await listFavorites(deps, requireUser(c).id) }));
  app.get('/notifications', async (c) => c.json({ notifications: await listNotifications(deps, requireUser(c)) }));
  app.post('/notifications/read', async (c) => {
    const input = await body(c, z.object({ ids: z.array(z.string().max(64)).max(200).nullable().default(null) }).strict());
    await markNotificationsRead(deps, requireUser(c), input.ids);
    return c.json({ ok: true });
  });

  return app;
}
