import { Hono } from 'hono';
import { deleteCookie } from 'hono/cookie';
import { AppError } from '../../shared/errors';
import { checkinSchema, manualCheckinSchema, scannerLoginSchema } from '../../shared/schemas';
import { LIMITS } from '../../shared/constants';
import { SESSION_COOKIE, body, limit, type AppEnv, type Ctx } from '../middleware/core';
import { getCheckinStats, listAttendees, manualCheckin, offlineManifest, scanTicket, scannerLogin, type ScanActor } from '../services/checkin';
import { destroySession } from '../services/users';
import { setSessionCookie } from './auth';
import type { Deps } from '../context';

function actorOf(c: Ctx): ScanActor {
  const session = c.get('session');
  const user = c.get('user');
  if (session?.kind === 'scanner') return { kind: 'scanner', session };
  if (user) return { kind: 'user', user };
  throw new AppError('unauthorized');
}

export function checkinRoutes(deps: Deps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post('/checkin', limit('scan', 600, 60_000, 'user'), async (c) => {
    const input = await body(c, checkinSchema);
    return c.json(await scanTicket(deps, actorOf(c), input));
  });

  app.post('/checkin/manual', limit('scan-manual', 300, 60_000, 'user'), async (c) => {
    const input = await body(c, manualCheckinSchema);
    return c.json(await manualCheckin(deps, actorOf(c), input));
  });

  app.get('/checkin/:eventId/stats', async (c) => c.json(await getCheckinStats(deps, actorOf(c), c.req.param('eventId'))));
  app.get('/checkin/:eventId/attendees', async (c) => {
    const actor = actorOf(c);
    return c.json({ attendees: await listAttendees(deps, actor, c.req.param('eventId'), false) });
  });
  app.get('/checkin/:eventId/manifest', limit('manifest', 20, 60 * 60_000, 'user'), async (c) => c.json(await offlineManifest(deps, actorOf(c), c.req.param('eventId'))));

  app.post('/scanner/login', limit('scanner-login', 10, 10 * 60_000), async (c) => {
    const { code } = await body(c, scannerLoginSchema);
    const result = await scannerLogin(deps, code, c.req.header('user-agent') ?? null);
    setSessionCookie(c, deps, result.token, LIMITS.scannerSessionHours * 3600);
    return c.json(result);
  });

  app.post('/scanner/logout', async (c) => {
    if (c.get('session')?.kind === 'scanner') await destroySession(deps, c.get('token'));
    deleteCookie(c, SESSION_COOKIE, { path: '/', secure: deps.config.cookieSecure });
    return c.json({ ok: true });
  });

  return app;
}
