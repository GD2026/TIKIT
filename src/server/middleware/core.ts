import type { Context, MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { ZodError, type ZodType } from 'zod';
import { AppError, ERROR_MESSAGES, type ApiErrorBody } from '../../shared/errors';
import { newId } from '../../shared/ids';
import { safeReturnPath } from '../../shared/redirect';
import type { Session, User } from '../../shared/types';
import type { Deps } from '../context';
import { UniqueViolation } from '../store/types';
import { resolveSession } from '../services/users';

export const SESSION_COOKIE = 'tikit_sid';
export const OAUTH_COOKIE = 'tikit_oauth';

export interface AppEnv {
  Variables: {
    deps: Deps;
    user: User | null;
    session: Session | null;
    token: string | null;
    authVia: 'cookie' | 'bearer' | null;
    requestId: string;
  };
}

export type Ctx = Context<AppEnv>;

// ── Request context ──────────────────────────────────────────────────────────

export function contextMiddleware(deps: Deps): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    c.set('deps', deps);
    c.set('requestId', newId(10));
    c.set('user', null);
    c.set('session', null);
    c.set('token', null);
    c.set('authVia', null);
    await next();
    c.header('X-Request-Id', c.get('requestId'));
  };
}

export function sessionMiddleware(deps: Deps): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const auth = c.req.header('authorization');
    let token: string | null = null;
    let via: 'cookie' | 'bearer' | null = null;
    if (auth && /^Bearer\s+/i.test(auth)) {
      token = auth.replace(/^Bearer\s+/i, '').trim();
      via = 'bearer';
    } else {
      const cookie = getCookie(c, SESSION_COOKIE);
      if (cookie) {
        token = cookie;
        via = 'cookie';
      }
    }
    if (token) {
      const resolved = await resolveSession(deps, token);
      if (resolved) {
        c.set('session', resolved.session);
        c.set('user', resolved.user);
        c.set('token', token);
        c.set('authVia', via);
      }
    }
    await next();
  };
}

// ── CSRF (cookie-authenticated, state-changing requests) ────────────────────

const CSRF_EXEMPT = [/^\/api\/webhooks\//, /^\/api\/auth\/callback\//, /^\/api\/cron$/];

export function csrfMiddleware(deps: Deps): MiddlewareHandler<AppEnv> {
  const allowedOrigin = (() => {
    try {
      return new URL(deps.config.publicUrl).origin;
    } catch {
      return null;
    }
  })();
  return async (c, next) => {
    const method = c.req.method.toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();
    const path = new URL(c.req.url).pathname;
    if (CSRF_EXEMPT.some((re) => re.test(path))) return next();
    // Bearer tokens are never sent automatically by browsers – no CSRF risk.
    if (c.req.header('authorization')?.toLowerCase().startsWith('bearer ')) return next();
    // Cookie-based requests must come from our own frontend: custom header + same origin.
    if (c.req.header('x-tikit') !== '1') throw new AppError('csrf');
    // The iOS app's web view (capacitor://localhost) is a trusted origin too; browsers never let a web page
    // claim that origin.
    const origin = c.req.header('origin');
    const trusted = origin === allowedOrigin || (!!origin && (deps.config.native?.trustedOrigins ?? []).includes(origin));
    if (origin && allowedOrigin && !trusted && deps.config.production) throw new AppError('csrf');
    return next();
  };
}

// ── Rate limiting (in-memory fixed window; one instance) ────────────────────

interface Bucket {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  private buckets = new Map<string, Bucket>();
  private lastSweep = 0;

  hit(key: string, limit: number, windowMs: number, now: number): { ok: boolean; retryAfter: number } {
    if (now - this.lastSweep > 60_000) {
      for (const [k, b] of this.buckets) if (b.resetAt <= now) this.buckets.delete(k);
      this.lastSweep = now;
    }
    const b = this.buckets.get(key);
    if (!b || b.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + windowMs });
      return { ok: true, retryAfter: 0 };
    }
    b.count++;
    if (b.count > limit) return { ok: false, retryAfter: Math.ceil((b.resetAt - now) / 1000) };
    return { ok: true, retryAfter: 0 };
  }
}

export function limit(name: string, max: number, windowMs: number, keyBy: 'ip' | 'user' = 'ip'): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const deps = c.get('deps');
    const limiter = getLimiter(deps);
    const who = keyBy === 'user' && c.get('user') ? `u:${c.get('user')!.id}` : `ip:${deps.clientIp(c.req.raw, c.env)}`;
    const res = limiter.hit(`${name}:${who}`, max, windowMs, deps.clock().getTime());
    if (!res.ok) {
      c.header('Retry-After', String(res.retryAfter));
      throw new AppError('rate_limited');
    }
    return next();
  };
}

const limiters = new WeakMap<Deps, RateLimiter>();
function getLimiter(deps: Deps): RateLimiter {
  let l = limiters.get(deps);
  if (!l) {
    l = new RateLimiter();
    limiters.set(deps, l);
  }
  return l;
}

// ── Helpers for handlers ─────────────────────────────────────────────────────

export function requireUser(c: Ctx): User {
  const user = c.get('user');
  if (!user) throw new AppError('unauthorized');
  return user;
}

export async function body<T>(c: Ctx, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    const text = await c.req.text();
    if (text.length > 3_000_000) throw new AppError('bad_request', { message: 'Forespørselen er for stor.' });
    raw = text ? JSON.parse(text) : {};
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('bad_request', { message: 'Ugyldig JSON.' });
  }
  return parse(schema, raw);
}

export function parse<T>(schema: ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (!result.success) throw zodToAppError(result.error);
  return result.data;
}

export function zodToAppError(err: ZodError): AppError {
  const fields: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.map(String).join('.') || '_';
    if (!fields[key]) fields[key] = issue.message;
  }
  const first = Object.values(fields)[0];
  return new AppError('validation', { fields, message: first && Object.keys(fields).length === 1 ? first : ERROR_MESSAGES.validation });
}

export function errorResponse(c: Ctx, err: unknown): Response {
  const deps = c.get('deps');
  const requestId = c.get('requestId');
  let appErr: AppError;
  if (err instanceof AppError) appErr = err;
  else if (err instanceof ZodError) appErr = zodToAppError(err);
  else if (err instanceof UniqueViolation) appErr = new AppError('conflict');
  else {
    deps?.log.error('Uventet feil', { requestId, path: c.req.path, error: err instanceof Error ? `${err.name}: ${err.message}\n${err.stack ?? ''}` : String(err) });
    appErr = new AppError('internal');
  }
  const bodyOut: ApiErrorBody = {
    error: {
      code: appErr.code,
      message: appErr.message,
      ...(appErr.fields ? { fields: appErr.fields } : {}),
      ...(appErr.details ? { details: appErr.details } : {}),
      requestId,
    },
  };
  return c.json(bodyOut, appErr.status as 400);
}

/** Safe relative redirect target (prevents open redirects). */
export function safeReturnTo(value: string | null | undefined, fallback = '/'): string {
  return safeReturnPath(value, fallback);
}
