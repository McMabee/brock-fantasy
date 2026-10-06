import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const publishableKey =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const isExpoWebServer = Platform.OS === 'web' && typeof document === 'undefined';
export const appEnvironment = process.env.EXPO_PUBLIC_APP_ENV ?? 'local';
export const supportEmail = process.env.EXPO_PUBLIC_SUPPORT_EMAIL;
export const hasSupabaseConfig = Boolean(url && publishableKey);

function isHttpsOrigin(value: string | undefined): boolean {
  if (!value) return false;
  try {
    return (
      new URL(value).protocol === 'https:' && new URL(value).origin === value.replace(/\/$/u, '')
    );
  } catch {
    return false;
  }
}

async function cookieAuthenticatedRead(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const request = input instanceof Request ? input : new Request(input, init);
  const target = new URL(request.url);
  const path = `${target.pathname}${target.search}`;
  if (!path.startsWith('/rest/v1/')) return fetch(request);
  return fetch(`/api/data/supabase?path=${encodeURIComponent(path)}`, {
    method: request.method,
    headers: request.headers,
    credentials: 'include',
    cache: 'no-store',
    ...(request.method === 'GET' || request.method === 'HEAD'
      ? {}
      : { body: await request.text() }),
  });
}

if (appEnvironment === 'production' || appEnvironment === 'staging') {
  if (!hasSupabaseConfig) {
    throw new Error(
      'Staging and production require EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY.',
    );
  }
  if (!supportEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(supportEmail)) {
    throw new Error('Staging and production require a valid EXPO_PUBLIC_SUPPORT_EMAIL.');
  }
  if (!isHttpsOrigin(process.env.EXPO_PUBLIC_APP_ORIGIN)) {
    throw new Error(
      'Staging and production require an HTTPS EXPO_PUBLIC_APP_ORIGIN without a path.',
    );
  }
}

export const supabase: SupabaseClient | null =
  !isExpoWebServer && url && publishableKey
    ? createClient(url, publishableKey, {
        auth: {
          storage: AsyncStorage,
          autoRefreshToken: Platform.OS !== 'web',
          persistSession: Platform.OS !== 'web',
          detectSessionInUrl: false,
        },
        ...(Platform.OS === 'web' ? { global: { fetch: cookieAuthenticatedRead } } : {}),
      })
    : null;
