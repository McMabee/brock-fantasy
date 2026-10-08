import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import { validatePublicAuthConfig } from './public-auth-config';

// Expo inlines these public values at build time. No server secrets belong here.
validatePublicAuthConfig({
  EXPO_PUBLIC_APP_ENV: process.env.EXPO_PUBLIC_APP_ENV,
  EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  EXPO_PUBLIC_APP_ORIGIN: process.env.EXPO_PUBLIC_APP_ORIGIN,
  EXPO_PUBLIC_SUPPORT_EMAIL: process.env.EXPO_PUBLIC_SUPPORT_EMAIL,
});

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const publishableKey =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const isExpoWebServer = Platform.OS === 'web' && typeof document === 'undefined';
export const appEnvironment = process.env.EXPO_PUBLIC_APP_ENV ?? 'local';
const requiredSupportRecipients = ['tymabee@proton.me', 'gt22me@brocku.ca'] as const;
export const supportEmail =
  process.env.EXPO_PUBLIC_SUPPORT_EMAIL ?? requiredSupportRecipients.join(',');
export const hasSupabaseConfig = Boolean(url && publishableKey);

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
