import { usePathname, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';
import { adminReturnPath } from '@/lib/admin-navigation';
import { webRequest } from '@/lib/web-request';
import { useSession } from '@/providers/session-provider';

export function useRequireUser(returnTo?: string) {
  const router = useRouter();
  const { user, loading } = useSession();
  useEffect(() => {
    if (!loading && !user)
      router.replace(returnTo ? { pathname: '/auth', params: { next: returnTo } } : '/auth');
  }, [loading, returnTo, router, user]);
  return { allowed: Boolean(user), loading };
}

export function useRequireAdmin() {
  const router = useRouter();
  const pathname = usePathname();
  const { user, loading } = useSession();
  const [access, setAccess] = useState<{
    userId: string | null;
    allowed: boolean;
    checking: boolean;
    error: string | null;
  }>({ userId: null, allowed: false, checking: true, error: null });
  useEffect(() => {
    if (loading) return;
    let cancelled = false;
    const next = adminReturnPath(pathname);
    if (!user) {
      router.replace({ pathname: '/auth', params: { next } });
      return;
    }
    setAccess({ userId: user.id, allowed: false, checking: true, error: null });
    const check = async () => {
      let hasRole = false;
      let verified = false;
      let error: string | null = null;
      if (Platform.OS === 'web') {
        const result = await webRequest<{
          authenticated: boolean;
          hasAdminRole: boolean;
          isAdmin: boolean;
          aal: string;
        }>('/api/admin/status');
        if (cancelled) return;
        if (result.data && !result.data.authenticated) {
          router.replace({ pathname: '/auth', params: { next } });
          return;
        }
        hasRole = result.data?.hasAdminRole === true;
        verified = result.data?.isAdmin === true;
        error = result.error;
      } else if (supabase) {
        const role = await supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', user.id)
          .eq('role', 'admin')
          .maybeSingle();
        const assurance = role.data
          ? await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
          : null;
        hasRole = Boolean(role.data);
        verified = assurance?.data?.currentLevel === 'aal2';
        error = role.error?.message ?? assurance?.error?.message ?? null;
      } else error = 'Administrator access is not configured for this environment.';
      if (cancelled) return;
      if (hasRole && !verified && !error) {
        router.replace({ pathname: '/mfa', params: { next } });
        return;
      }
      setAccess({ userId: user.id, allowed: verified, checking: false, error });
    };
    void check().catch(() => {
      if (!cancelled)
        setAccess({
          userId: user.id,
          allowed: false,
          checking: false,
          error: 'Unable to check administrator access. Refresh to try again.',
        });
    });
    return () => {
      cancelled = true;
    };
  }, [loading, pathname, router, user]);
  return {
    allowed: Boolean(user && access.userId === user.id && access.allowed),
    loading: loading || Boolean(user && access.userId !== user.id) || access.checking,
    error: access.error,
  };
}
