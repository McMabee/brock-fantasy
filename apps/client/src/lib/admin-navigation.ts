export const adminRoutes = [
  '/admin',
  '/admin/games',
  '/admin/import',
  '/admin/accounts',
  '/admin/rankings',
  '/admin/history',
  '/admin/leagues',
  '/admin/participants',
  '/admin/schedules',
  '/admin/syncs',
  '/admin/alerts',
  '/admin/audit',
] as const;

export function adminLeaguePath(pathname: string, params: Record<string, unknown> = {}): string {
  if (
    !/^\/admin\/leagues(?:\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?$/iu.test(
      pathname,
    )
  )
    return '/admin/leagues';
  const query = new URLSearchParams();
  for (const name of ['season', 'status', 'q', 'beforeAt', 'beforeId', 'page', 'tab', 'teamId']) {
    const value = params[name];
    if (typeof value === 'string' && value.length <= 320) query.set(name, value);
  }
  return `${pathname}${query.size ? `?${query}` : ''}`;
}

function safeLeagueReturn(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith('/admin/leagues')) return null;
  try {
    const url = new URL(value, 'https://same-origin.invalid');
    if (
      url.origin !== 'https://same-origin.invalid' ||
      url.hash ||
      adminLeaguePath(url.pathname) !== url.pathname
    )
      return null;
    return adminLeaguePath(url.pathname, Object.fromEntries(url.searchParams));
  } catch {
    return null;
  }
}

export function adminReturnPath(value: unknown): string {
  const league = safeLeagueReturn(value);
  if (league) return league;
  return safeAdminReturn(value) ?? '/admin';
}

function safeAdminReturn(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return null;
  try {
    const url = new URL(value, 'https://same-origin.invalid');
    if (
      url.origin !== 'https://same-origin.invalid' ||
      url.hash ||
      !adminRoutes.some((route) => route === url.pathname) ||
      value.split('?')[0] !== url.pathname
    )
      return null;
    return adminPagePath(url.pathname, Object.fromEntries(url.searchParams));
  } catch {
    return null;
  }
}

export function adminPagePath(pathname: string, params: Record<string, unknown> = {}): string {
  if (pathname.startsWith('/admin/leagues')) return adminLeaguePath(pathname, params);
  if (!adminRoutes.some((route) => route === pathname)) return '/admin';
  const query = new URLSearchParams();
  for (const name of [
    'q',
    'kind',
    'status',
    'category',
    'actor',
    'entity',
    'from',
    'to',
    'beforeAt',
    'beforeId',
    'page',
    'season',
    'view',
  ]) {
    const value = params[name];
    if (typeof value === 'string' && value.length <= 320) query.set(name, value);
  }
  return `${pathname}${query.size ? `?${query}` : ''}`;
}

export function authReturnPath(value: unknown): string {
  if (typeof value !== 'string') return '/dashboard';
  const league = safeLeagueReturn(value);
  if (league) return league;
  if (value.startsWith('/admin/')) return safeAdminReturn(value) ?? '/dashboard';
  if (
    /^\/participation\/confirm\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(
      value,
    )
  )
    return value;
  const invitation = /^\/leagues\/join\?code=([A-Z0-9]{8}|[A-Z0-9]{12})$/iu.exec(value);
  if (invitation) return `/leagues/join?code=${invitation[1]!.toUpperCase()}`;
  if (
    [
      '/dashboard',
      '/players',
      '/account',
      '/notifications',
      '/leagues/new',
      '/leagues/join',
      ...adminRoutes,
    ].includes(value)
  )
    return value;
  if (
    /^\/(?:draft|league|matchups|commissioner|lineup-beta|lineup-multisport|lineup|transactions|players)\/[0-9a-f-]{36}$/iu.test(
      value,
    )
  )
    return value;
  if (typeof value === 'string' && /^\/mfa\?invitation=[0-9a-f-]{36}$/iu.test(value)) return value;
  return '/dashboard';
}
