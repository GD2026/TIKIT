import { Hono } from 'hono';
import { AppError } from '../shared/errors';
import type { Deps } from './context';
import { contextMiddleware, csrfMiddleware, errorResponse, limit, sessionMiddleware, type AppEnv } from './middleware/core';
import { authRoutes } from './routes/auth';
import { publicRoutes } from './routes/public';
import { meRoutes } from './routes/me';
import { buyingRoutes } from './routes/buying';
import { orgRoutes } from './routes/org';
import { checkinRoutes } from './routes/checkin';
import { adminRoutes } from './routes/admin';
import { systemRoutes } from './routes/system';

/**
 * The TIKIT API. Runs unchanged on the Node server (Postgres, real Vipps/Google/Apple/Stripe)
 * and inside the browser for the live demo (memory store, simulated providers).
 */
export function createApp(deps: Deps): Hono<AppEnv> {
  const api = new Hono<AppEnv>();
  api.use('*', contextMiddleware(deps));
  api.use('*', async (c, next) => {
    await next();
    if (!c.res.headers.has('Cache-Control')) c.header('Cache-Control', 'no-store');
    c.header('X-Content-Type-Options', 'nosniff');
  });
  api.use('*', sessionMiddleware(deps));
  api.use('*', csrfMiddleware(deps));
  api.use('*', limit('api', 900, 60_000));

  api.route('/', publicRoutes(deps));
  api.route('/auth', authRoutes(deps));
  api.route('/me', meRoutes(deps));
  api.route('/', buyingRoutes(deps));
  api.route('/org', orgRoutes(deps));
  api.route('/', checkinRoutes(deps));
  api.route('/admin', adminRoutes(deps));
  api.route('/', systemRoutes(deps));

  api.notFound((c) => errorResponse(c, new AppError('not_found')));
  api.onError((err, c) => errorResponse(c, err));

  const app = new Hono<AppEnv>();
  app.route('/api', api);
  app.onError((err, c) => errorResponse(c, err));
  return app;
}
