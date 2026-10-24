import { Platform } from 'react-native';
import { refreshWebSession, sessionNeedsRenewal } from './web-session';

export async function webRequest<T>(
  path: string,
  options: { method?: 'GET' | 'POST'; body?: Record<string, unknown> } = {},
): Promise<{ data: T | null; error: string | null; status?: number; code?: string }> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { accept: 'application/json' };
  if (options.body) headers['content-type'] = 'application/json';
  if (Platform.OS === 'web' && method !== 'GET') {
    const token = document.cookie
      .split('; ')
      .find((value) => value.startsWith('bf_csrf='))
      ?.split('=')[1];
    if (token) headers['x-csrf-token'] = decodeURIComponent(token);
  }
  try {
    if (Platform.OS === 'web' && sessionNeedsRenewal()) {
      const renewal = await refreshWebSession();
      if (renewal.error) return { data: null, error: renewal.error, status: renewal.status };
    }
    const send = () => {
      if (Platform.OS === 'web' && method !== 'GET') {
        const csrf = document.cookie
          .split('; ')
          .find((v) => v.startsWith('bf_csrf='))
          ?.split('=')[1];
        if (csrf) headers['x-csrf-token'] = decodeURIComponent(csrf);
      }
      return fetch(path, {
        method,
        headers,
        credentials: 'include',
        cache: 'no-store',
        ...(options.body ? { body: JSON.stringify(options.body) } : {}),
      });
    };
    let response = await send();
    if (response.status === 401 && Platform.OS === 'web') {
      const renewal = await refreshWebSession();
      if (renewal.error) return { data: null, error: renewal.error, status: renewal.status };
      // - Renewal rotates CSRF alongside the HttpOnly access cookie
      const csrf = document.cookie
        .split('; ')
        .find((v) => v.startsWith('bf_csrf='))
        ?.split('=')[1];
      if (csrf && method !== 'GET') headers['x-csrf-token'] = decodeURIComponent(csrf);
      response = await send();
    }
    const payload = (await response.json().catch(() => ({}))) as T & {
      error?: string;
      code?: string;
    };
    return response.ok
      ? { data: payload, error: null, status: response.status }
      : {
          data: null,
          error:
            payload.error ??
            (response.status >= 500 ? 'Connection unavailable. Reconnecting…' : 'Request failed.'),
          status: response.status,
          ...(typeof payload.code === 'string' ? { code: payload.code } : {}),
        };
  } catch {
    return { data: null, error: 'Unable to reach the Brock Fantasy server.' };
  }
}
