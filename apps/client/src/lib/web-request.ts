import { Platform } from 'react-native';

export async function webRequest<T>(
  path: string,
  options: { method?: 'GET' | 'POST'; body?: Record<string, unknown> } = {},
): Promise<{ data: T | null; error: string | null }> {
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
    const response = await fetch(path, {
      method,
      headers,
      credentials: 'include',
      cache: 'no-store',
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });
    const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
    return response.ok
      ? { data: payload, error: null }
      : { data: null, error: payload.error ?? 'Request failed.' };
  } catch {
    return { data: null, error: 'Unable to reach the Brock Fantasy server.' };
  }
}
