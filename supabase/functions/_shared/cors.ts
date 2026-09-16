export function corsHeaders(origin: string | null): Record<string, string> {
  const allowedOrigins = (Deno.env.get('ALLOWED_ORIGINS') ?? 'http://localhost:8081')
    .split(',')
    .map((item) => item.trim());
  const allowedOrigin =
    origin && allowedOrigins.includes(origin) ? origin : (allowedOrigins[0] ?? '');
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}
