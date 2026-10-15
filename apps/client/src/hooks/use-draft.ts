import { legalDraftAthletes } from '@brock-fantasy/domain';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { supabase } from '@/lib/supabase';
import { webRequest } from '@/lib/web-request';
import { useSession } from '@/providers/session-provider';
import type { DraftSnapshot, DraftViewState } from '@/lib/draft-state';

export type { DraftViewState } from '@/lib/draft-state';
const initial: Omit<DraftViewState, 'reload'> = {
  draft: null,
  leagueName: '',
  teams: [],
  athletes: [],
  picks: [],
  rankings: new Map(),
  queuedAthleteIds: [],
  myTeamId: null,
  roster: [],
  slots: [],
  candidates: [],
  legalAthleteIds: new Set(),
  serverOffset: 0,
  loading: true,
  connected: false,
  error: null,
};
export function useDraft(draftId: string | undefined): DraftViewState {
  const { user } = useSession();
  const [state, setState] = useState(initial);
  const revision = useRef<string | undefined>(undefined);
  const poolRevision = useRef<string | undefined>(undefined);
  const generation = useRef(0);
  const pending = useRef<Promise<boolean> | null>(null);
  const failures = useRef(0);
  const reload = useCallback((): Promise<boolean> => {
    if (pending.current) return pending.current;
    const currentGeneration = generation.current;
    const promise = (async () => {
      if (!draftId || !user?.id) {
        setState((s) => ({ ...s, loading: false }));
        return false;
      }
      const query = new URLSearchParams();
      if (revision.current) query.set('revision', revision.current);
      if (poolRevision.current) query.set('poolRevision', poolRevision.current);
      try {
        const result =
          Platform.OS === 'web'
            ? await webRequest<DraftSnapshot>(
                '/api/draft/' + draftId + '/state?' + query.toString(),
              )
            : supabase
              ? ((await supabase.rpc('get_draft_room_snapshot', {
                  p_draft_id: draftId,
                  p_known_revision: revision.current ?? null,
                  p_known_pool_revision: poolRevision.current ?? null,
                })) as { data: DraftSnapshot | null; error: { message: string } | null })
              : { data: null, error: 'Draft service is unavailable.' };
        if (currentGeneration !== generation.current) return false;
        if (result.error || !result.data) {
          failures.current++;
          const denied = 'status' in result && (result.status === 401 || result.status === 403);
          setState((s) => ({
            ...(denied ? initial : s),
            loading: false,
            connected: false,
            error:
              typeof result.error === 'string'
                ? result.error
                : (result.error?.message ?? 'Reconnecting…'),
          }));
          return false;
        }
        const snapshot = result.data;
        if (
          typeof snapshot.revision !== 'string' ||
          typeof snapshot.poolRevision !== 'string' ||
          !Number.isFinite(Date.parse(snapshot.serverTime))
        )
          throw new Error('Invalid draft response');
        const serverOffset = Date.parse(snapshot.serverTime) - Date.now();
        if (snapshot.unchanged) {
          if (!revision.current) throw new Error('Missing initial draft snapshot');
          failures.current = 0;
          setState((s) =>
            s.connected && !s.error && Math.abs(s.serverOffset - serverOffset) < 250
              ? s
              : { ...s, connected: true, error: null, serverOffset },
          );
          return true;
        }
        const d = snapshot.draft;
        if (!d || !snapshot.league) throw new Error('Invalid draft response');
        if (snapshot.closed) {
          setState({
            ...initial,
            loading: false,
            connected: true,
            draft: {
              id: d.id,
              leagueId: d.league_id,
              status: d.status,
              rounds: d.rounds,
              currentOverallPick: d.current_overall_pick,
              stateVersion: d.state_version,
              teamIdsInDraftOrder: d.team_order,
              picks: [],
            },
          });
          return true;
        }
        failures.current = 0;
        revision.current = snapshot.revision;
        poolRevision.current = snapshot.poolRevision;
        setState((s) => {
          const picks = (snapshot.picks ?? []).map((p) => ({
            id: p.id,
            draftId: p.draft_id,
            fantasyTeamId: p.fantasy_team_id,
            athleteId: p.athlete_id,
            overallPick: p.overall_pick,
            round: p.round,
            pickInRound: p.pick_in_round,
            source: p.source,
            createdAt: p.created_at,
          }));
          const athletes = snapshot.players
            ? snapshot.players.map((a) => ({
                id: a.id,
                competitionId: a.competition_id,
                teamId: a.team_id,
                displayName: a.display_name,
                position: a.position,
                ...(a.jersey_number ? { jerseyNumber: a.jersey_number } : {}),
                status: a.status,
                positions: a.positions,
                program: a.program,
                rank: a.rank,
                bio: a.bio,
                summaries: a.summaries,
                ...(a.adp ? { adp: a.adp } : {}),
              }))
            : s.athletes;
          return {
            draft: {
              id: d.id,
              leagueId: d.league_id,
              status: d.status,
              rounds: d.rounds,
              currentOverallPick: d.current_overall_pick,
              stateVersion: d.state_version,
              ...(d.pick_deadline ? { pickDeadline: d.pick_deadline } : {}),
              teamIdsInDraftOrder: d.team_order,
              picks,
            },
            leagueName: snapshot.league!.name,
            teams: (snapshot.teams ?? []).map((t) => ({
              id: t.id,
              leagueId: t.league_id,
              ownerId: t.owner_id ?? '',
              name: t.name,
              draftPosition: t.draft_position,
            })),
            athletes,
            picks,
            rankings: new Map(athletes.map((a) => [a.id, a.rank])),
            queuedAthleteIds: snapshot.queue ?? [],
            myTeamId: snapshot.myTeamId ?? null,
            roster: snapshot.roster ?? [],
            slots: snapshot.slots ?? [],
            candidates: snapshot.candidates ?? [],
            legalAthleteIds: new Set(
              snapshot.legalAthleteIds ??
                (snapshot.myTeamId
                  ? legalDraftAthletes(
                      snapshot.candidates ?? [],
                      snapshot.slots ?? [],
                      snapshot.myTeamId,
                    )
                  : []),
            ),
            serverOffset,
            loading: false,
            connected: true,
            error: null,
          };
        });
        return true;
      } catch {
        if (currentGeneration === generation.current) {
          failures.current++;
          setState((s) => ({
            ...s,
            loading: false,
            connected: false,
            error: 'Connection unavailable. Reconnecting…',
          }));
        }
        return false;
      }
    })();
    pending.current = promise;
    void promise.finally(() => {
      if (pending.current === promise) pending.current = null;
    });
    return promise;
  }, [draftId, user?.id]);
  useEffect(() => {
    generation.current++;
    revision.current = undefined;
    poolRevision.current = undefined;
    pending.current = null;
    failures.current = 0;
    setState(initial);
    if (!draftId || !user?.id) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      await reload();
      if (active)
        timer = setTimeout(
          () => void poll(),
          Math.min(15_000, 2000 * 2 ** Math.min(failures.current, 3)),
        );
    };
    void poll();
    const focus = () => {
      if (active) void reload();
    };
    if (Platform.OS === 'web') window.addEventListener('focus', focus);
    return () => {
      active = false;
      generation.current++;
      clearTimeout(timer);
      if (Platform.OS === 'web') window.removeEventListener('focus', focus);
    };
  }, [draftId, reload, user?.id]);
  return { ...state, reload };
}
