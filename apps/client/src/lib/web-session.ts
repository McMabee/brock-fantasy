import type { WebSessionUser } from './web-auth';

interface RenewalResult {
  data: { user: WebSessionUser; expiresAt?: number } | null;
  error: string | null;
  status: number;
}
let expiresAt = 0;
let pending: Promise<RenewalResult> | null = null;
const listeners = new Set<(result: RenewalResult) => void>();

export function recordSessionExpiry(value: unknown): void {
  if (typeof value === 'number' && Number.isFinite(value)) expiresAt = value;
}
export function sessionNeedsRenewal(): boolean {
  return expiresAt > 0 && expiresAt - Date.now() < 90_000;
}
export function onSessionRenewed(listener: (result: RenewalResult) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

async function renew(): Promise<RenewalResult> {
  try {
    const check = await fetch('/api/auth/session', { credentials: 'include', cache: 'no-store' });
    const existing = (await check.json()) as { user?: WebSessionUser; expiresAt?: number };
    if (check.ok && existing.user && existing.expiresAt && existing.expiresAt > Date.now() + 90_000)
      return {
        data: { user: existing.user, expiresAt: existing.expiresAt },
        error: null,
        status: 200,
      };
    if (check.status >= 500)
      return { data: null, error: 'Connection unavailable. Retrying…', status: check.status };
    const csrfValue = () =>
      document.cookie
        .split('; ')
        .find((v) => v.startsWith('bf_csrf='))
        ?.split('=')[1];
    if (!csrfValue()) {
      const csrf = await fetch('/api/auth/csrf', { credentials: 'include', cache: 'no-store' });
      if (!csrf.ok)
        return { data: null, error: 'Connection unavailable. Retrying…', status: csrf.status };
    }
    const response = await fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
      headers: { 'x-csrf-token': decodeURIComponent(csrfValue() ?? '') },
    });
    const payload = (await response.json()) as {
      user?: WebSessionUser;
      expiresAt?: number;
      error?: string;
    };
    return response.ok && payload.user
      ? {
          data: {
            user: payload.user,
            ...(payload.expiresAt ? { expiresAt: payload.expiresAt } : {}),
          },
          error: null,
          status: response.status,
        }
      : { data: null, error: payload.error ?? 'Please sign in again.', status: response.status };
  } catch {
    return { data: null, error: 'Connection unavailable. Retrying…', status: 503 };
  }
}

/** Web Locks coordinate cookie rotation across tabs; pending coalesces callers in this tab. */
export function refreshWebSession(): Promise<RenewalResult> {
  if (pending) return pending;
  pending = (
    typeof navigator !== 'undefined' && navigator.locks
      ? navigator.locks.request('brock-session-renewal', renew)
      : renew()
  )
    .then((result) => {
      if (result.status === 401 || result.status === 403) expiresAt = 0;
      recordSessionExpiry(result.data?.expiresAt);
      for (const listener of listeners) listener(result);
      return result;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}
