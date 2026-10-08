import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { supabase } from '@/lib/supabase';
import { webRequest } from '@/lib/web-request';
import { useSession } from '@/providers/session-provider';

export function useAdminAccountManager(enabled: boolean) {
  const { user } = useSession();
  const [managerId, setManagerId] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled || !user) return;
    let cancelled = false;
    const check = async () => {
      const allowed =
        Platform.OS === 'web'
          ? (await webRequest<{ canManage: boolean }>('/api/admin/accounts')).data?.canManage ===
            true
          : (await supabase?.rpc('can_manage_admin_accounts'))?.data === true;
      if (!cancelled) setManagerId(allowed ? user.id : null);
    };
    void check().catch(() => {
      if (!cancelled) setManagerId(null);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, user]);
  return enabled && Boolean(user && managerId === user.id);
}
