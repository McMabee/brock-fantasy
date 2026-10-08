import { isIP } from 'node:net';

type Environment = Record<string, string | undefined>;
type RateResult = { status: 'allowed' | 'limited' | 'unavailable'; retryAfterSeconds: number };
type Diagnostic = {
  event: 'brock_auth_rate_limit_unavailable';
  reason:
    | 'unsupported_action'
    | 'vercel_runtime_missing'
    | 'app_environment_invalid'
    | 'supabase_project_mismatch'
    | 'hmac_secret_missing_or_short'
    | 'server_credential_missing'
    | 'server_credential_invalid'
    | 'trusted_ip_missing_or_invalid'
    | 'hmac_failed'
    | 'rpc_network_or_timeout'
    | 'rpc_http_error'
    | 'rpc_invalid_response';
  httpStatus?: number;
};
const actions = new Set(['sign-in', 'sign-up', 'recover', 'refresh', 'update-password']);

/** Server-only: both Vercel hosts must use the same private HMAC secret. */
export function createAuthRateLimiter(
  options: {
    env?: () => Environment;
    fetchImpl?: typeof fetch;
    now?: () => number;
    onUnavailable?: (diagnostic: Diagnostic) => void;
  } = {},
) {
  const readEnv: () => Environment = options.env ?? (() => process.env);
  const fetchImpl: typeof fetch = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const now = options.now ?? Date.now;
  const onUnavailable = options.onUnavailable ?? ((entry) => console.error(JSON.stringify(entry)));
  function unavailable(reason: Diagnostic['reason'], httpStatus?: number): RateResult {
    // Allowlisted codes/status only: never log inputs, IPs, keys, tokens or error bodies.
    onUnavailable({
      event: 'brock_auth_rate_limit_unavailable',
      reason,
      ...(httpStatus === undefined ? {} : { httpStatus }),
    });
    return { status: 'unavailable', retryAfterSeconds: 30 };
  }
  const localWindows = new Map<string, { count: number; window: number }>();

  return async function limit(request: Request, action: string): Promise<RateResult> {
    if (!actions.has(action)) return unavailable('unsupported_action');
    const env = readEnv();
    const local = env.EXPO_PUBLIC_APP_ENV === 'local' && env.VERCEL !== '1';
    const seconds = 60;
    const maximum = action === 'sign-in' ? 8 : 5;
    const window = Math.floor(now() / (seconds * 1000));
    const retryAfterSeconds = seconds - (Math.floor(now() / 1000) % seconds);
    if (local) {
      // Local previews have no trusted ingress. Use one development bucket,
      // rather than treating arbitrary forwarded headers as authenticated IPs.
      for (const [key, entry] of localWindows) if (entry.window < window) localWindows.delete(key);
      const entry = localWindows.get(action);
      const count = entry?.window === window ? entry.count + 1 : 1;
      localWindows.set(action, { count, window });
      return { status: count <= maximum ? 'allowed' : 'limited', retryAfterSeconds };
    }
    if (env.VERCEL !== '1') return unavailable('vercel_runtime_missing');
    // VERCEL_ENV=preview is supported; application staging is independent of Vercel's target.
    if (!['staging', 'production'].includes(env.EXPO_PUBLIC_APP_ENV ?? ''))
      return unavailable('app_environment_invalid');
    if (
      env.EXPO_PUBLIC_SUPABASE_URL?.replace(/\/$/u, '') !==
      'https://fdovowiihxowzatewxgv.supabase.co'
    )
      return unavailable('supabase_project_mismatch');
    if (!env.AUTH_RATE_LIMIT_HMAC_SECRET || env.AUTH_RATE_LIMIT_HMAC_SECRET.trim().length < 32)
      return unavailable('hmac_secret_missing_or_short');
    if (!env.SUPABASE_SECRET_KEY) return unavailable('server_credential_missing');

    // Vercel supplies/overwrites these headers. Other hosting needs its own
    // verified ingress adapter; arbitrary proxies cannot opt into this trust.
    const address = (
      request.headers.get('x-vercel-forwarded-for') ?? request.headers.get('x-forwarded-for')
    )?.trim();
    if (!address || !isIP(address)) return unavailable('trusted_ip_missing_or_invalid');
    let failure: Diagnostic['reason'] = 'hmac_failed';
    try {
      const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(env.AUTH_RATE_LIMIT_HMAC_SECRET),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
      );
      // Normalize equivalent IPv6 representations before deriving the key.
      const canonical =
        isIP(address) === 6 ? new URL(`http://[${address}]/`).hostname.slice(1, -1) : address;
      const mac = await crypto.subtle.sign(
        'HMAC',
        key,
        new TextEncoder().encode(`brock-web-auth-v1:${action}:${canonical}`),
      );
      const identifier = Array.from(new Uint8Array(mac), (byte) =>
        byte.toString(16).padStart(2, '0'),
      ).join('');
      const credential = env.SUPABASE_SECRET_KEY;
      failure = 'server_credential_invalid';
      const headers: Record<string, string> = {
        apikey: credential,
        'content-type': 'application/json',
      };
      if (credential.startsWith('sb_secret_')) {
        // New secret API keys go only in apikey; they are not JWTs.
      } else {
        const payload: unknown = JSON.parse(
          Buffer.from(credential.split('.')[1] ?? '', 'base64url').toString('utf8'),
        );
        if (
          !payload ||
          typeof payload !== 'object' ||
          !('role' in payload) ||
          payload.role !== 'service_role'
        )
          return unavailable('server_credential_invalid');
        headers.authorization = `Bearer ${credential}`;
      }
      failure = 'rpc_network_or_timeout';
      const response = await fetchImpl(
        `${env.EXPO_PUBLIC_SUPABASE_URL.replace(/\/$/u, '')}/rest/v1/rpc/consume_rate_limit`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ p_key: identifier, p_limit: maximum, p_seconds: seconds }),
          signal: AbortSignal.timeout(3000),
          redirect: 'error',
        },
      );
      if (!response.ok) return unavailable('rpc_http_error', response.status);
      failure = 'rpc_invalid_response';
      const allowed: unknown = await response.json();
      if (typeof allowed !== 'boolean') return unavailable('rpc_invalid_response');
      return { status: allowed ? 'allowed' : 'limited', retryAfterSeconds };
    } catch {
      // No IP, credential or provider response body enters application logs.
      return unavailable(failure);
    }
  };
}

export const limitAuthRequest = createAuthRateLimiter();
