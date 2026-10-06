import { Platform } from 'react-native';

export interface WebSessionUser {
  id: string;
  email: string | null;
  emailConfirmedAt: string | null;
}

interface ApiError {
  error?: string;
}

function csrfToken(): string | null {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return null;
  return (
    document.cookie
      .split('; ')
      .find((value) => value.startsWith('bf_csrf='))
      ?.split('=')[1] ?? null
  );
}

export async function webAuth<T>(
  action: string,
  options: { method?: 'GET' | 'POST'; body?: Record<string, unknown>; csrf?: boolean } = {},
): Promise<{ data: T | null; error: string | null }> {
  const method = options.method ?? 'POST';
  const headers: Record<string, string> = { accept: 'application/json' };
  if (options.body) headers['content-type'] = 'application/json';
  if (method !== 'GET' && options.csrf !== false) {
    const token = csrfToken();
    if (token) headers['x-csrf-token'] = decodeURIComponent(token);
  }
  try {
    const response = await fetch(`/api/auth/${action}`, {
      method,
      headers,
      credentials: 'include',
      cache: 'no-store',
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });
    const payload = (await response.json().catch(() => ({}))) as T & ApiError;
    return response.ok
      ? { data: payload, error: null }
      : { data: null, error: payload.error ?? 'The request could not be completed.' };
  } catch {
    return { data: null, error: 'Unable to reach the Brock Fantasy server.' };
  }
}

export async function ensureCsrfToken(): Promise<void> {
  if (Platform.OS === 'web' && !csrfToken()) await webAuth('csrf', { method: 'GET', csrf: false });
}
