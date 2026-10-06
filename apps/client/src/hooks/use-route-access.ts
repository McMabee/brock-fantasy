import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';
import { webRequest } from '@/lib/web-request';
import { useSession } from '@/providers/session-provider';

export function useRequireUser() {
  const router = useRouter();
  const { user, loading } = useSession();
  useEffect(() => {
    if (!loading && !user) router.replace('/auth');
  }, [loading, router, user]);
  return { allowed: Boolean(user), loading };
}

export function useRequireAdmin() {
  const router = useRouter();
  const { user, loading } = useSession();
  const [authorized, setAuthorized] = useState(false);
  useEffect(() => {
    if (loading) return;
    if (!user || !supabase) {
      router.replace('/auth');
      return;
    }
    if (Platform.OS === 'web') {
      void webRequest<{
        authenticated: boolean;
        hasAdminRole: boolean;
        isAdmin: boolean;
        aal: string;
      }>('/api/admin/status').then(({ data }) => {
        if (data?.isAdmin) setAuthorized(true);
        else
          router.replace(
            data?.authenticated && data.hasAdminRole && data.aal !== 'aal2' ? '/mfa' : '/dashboard',
          );
      });
      return;
    }
    void supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('role', 'admin')
      .maybeSingle()
      .then(async ({ data }) => {
        if (!data) {
          router.replace('/dashboard');
          return;
        }
        const assurance = await supabase?.auth.mfa.getAuthenticatorAssuranceLevel();
        if (assurance?.data?.currentLevel === 'aal2') setAuthorized(true);
        else router.replace('/mfa');
      });
  }, [loading, router, user]);
  return { allowed: authorized, loading };
}
