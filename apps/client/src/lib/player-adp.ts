import { BETA_PLAYER_POOL_ID } from '@brock-fantasy/domain';
import { supabase } from './supabase';

export interface PlayerAdp {
  average: number | null;
  base: number | null;
  samples: number;
}
export type PlayerAdps = Readonly<Record<string, PlayerAdp>>;

export async function loadPlayerAdps(): Promise<PlayerAdps> {
  if (!supabase) return {};
  const result = await supabase.rpc('get_pool_adp', { p_pool_id: BETA_PLAYER_POOL_ID });
  if (result.error || !result.data || typeof result.data !== 'object' || Array.isArray(result.data))
    throw new Error('Average draft positions could not load.');
  return result.data as PlayerAdps;
}

export function adpLabel(adp: PlayerAdp | undefined): string {
  if (!adp) return 'ADP unavailable';
  if (!adp.samples) return adp.base === null ? 'No recorded picks yet' : 'Supplied starting value';
  return `${adp.samples} recorded ${adp.samples === 1 ? 'pick' : 'picks'} across leagues${adp.base === null ? '' : ' · includes supplied starting value'}`;
}
