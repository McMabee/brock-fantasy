import type { Href } from 'expo-router';

const allowedPath = /^\/(?:draft|league|transactions|lineup|commissioner)\/[A-Za-z0-9-]{1,100}$/u;
const allowedSegment = /^[A-Za-z0-9-]{1,100}$/u;

export function notificationHref(data: unknown): Href | null {
  if (!isRecord(data)) return null;
  if (typeof data.path === 'string' && allowedPath.test(data.path)) return data.path;

  const draftId = stringValue(data.draft_id) ?? stringValue(data.draftId);
  if (draftId && allowedSegment.test(draftId)) return `/draft/${draftId}` as Href;

  const leagueId = stringValue(data.league_id) ?? stringValue(data.leagueId);
  if (leagueId && allowedSegment.test(leagueId)) return `/league/${leagueId}` as Href;
  return null;
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
