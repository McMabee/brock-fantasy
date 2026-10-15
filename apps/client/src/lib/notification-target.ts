const uuid = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu.test(value);
export function notificationTarget(kind: string, data: Record<string, unknown>): string {
  if (kind.startsWith('trade') && uuid(data.league_id)) return '/transactions/' + data.league_id;
  if (kind.startsWith('draft') && uuid(data.draft_id)) return '/draft/' + data.draft_id;
  if (kind.startsWith('draft') && uuid(data.league_id)) return '/league/' + data.league_id;
  if (kind.startsWith('game') && uuid(data.league_id))
    return '/lineup-multisport/' + data.league_id;
  return '/dashboard';
}
