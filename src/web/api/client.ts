import type { ApiErrorBody, ErrorCode } from '../../shared/errors';
import { ERROR_MESSAGES } from '../../shared/errors';

/** Where requests go: the real server (fetch) or the in-browser demo backend. */
export interface Transport {
  readonly kind: 'http' | 'local';
  request(path: string, init: RequestInit): Promise<Response>;
  /** Local transport keeps its own bearer token (cookies are unavailable to in-page requests). */
  setToken?(token: string | null): void;
  /** Resolves `/api/...` resource URLs (images) to something an <img> can load. */
  resolveUrl?(url: string): Promise<string>;
}

export class ApiError extends Error {
  readonly code: ErrorCode | 'network';
  readonly status: number;
  readonly fields: Record<string, string> | undefined;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: ErrorCode | 'network', message: string, status: number, fields?: Record<string, string>, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.fields = fields;
    this.details = details;
  }
}

export function createHttpTransport(base = '/api'): Transport {
  return {
    kind: 'http',
    request(path, init) {
      return fetch(`${base}${path}`, { ...init, credentials: 'same-origin' });
    },
  };
}

export interface Api {
  transport: Transport;
  get<T>(path: string, headers?: Record<string, string>): Promise<T>;
  post<T>(path: string, body?: unknown, headers?: Record<string, string>): Promise<T>;
  put<T>(path: string, body?: unknown): Promise<T>;
  patch<T>(path: string, body?: unknown): Promise<T>;
  del<T>(path: string): Promise<T>;
  raw(path: string, init?: RequestInit): Promise<Response>;
}

export function createApi(transport: Transport): Api {
  async function send<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
    let res: Response;
    try {
      res = await transport.request(path, {
        method,
        headers: {
          Accept: 'application/json',
          'X-Tikit': '1',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiError('network', 'Får ikke kontakt med TIKIT. Sjekk nettforbindelsen og prøv igjen.', 0);
    }
    const text = await res.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
    }
    if (!res.ok) {
      const err = (data as ApiErrorBody | null)?.error;
      if (err?.code) {
        // Unexpected server errors carry a reference that support can find in the server log.
        const message = err.code === 'internal' && err.requestId ? `${err.message} (ref. ${err.requestId})` : err.message;
        throw new ApiError(err.code, message, res.status, err.fields, err.details);
      }
      if (res.status === 429) throw new ApiError('rate_limited', ERROR_MESSAGES.rate_limited, 429);
      throw new ApiError('internal', ERROR_MESSAGES.internal, res.status);
    }
    return data as T;
  }
  return {
    transport,
    get: (path, headers) => send('GET', path, undefined, headers),
    post: (path, body, headers) => send('POST', path, body ?? {}, headers),
    put: (path, body) => send('PUT', path, body ?? {}),
    patch: (path, body) => send('PATCH', path, body ?? {}),
    del: (path) => send('DELETE', path),
    raw: (path, init = {}) => transport.request(path, { ...init, headers: { 'X-Tikit': '1', ...(init.headers as Record<string, string> | undefined) } }),
  };
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return ERROR_MESSAGES.internal;
}
