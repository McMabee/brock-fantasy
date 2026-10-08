type PublicAuthConfig = Record<string, string | undefined>;

/** Only public browser configuration belongs here; never read server credentials. */
export function validatePublicAuthConfig(values: PublicAuthConfig): void {
  const environment = values.EXPO_PUBLIC_APP_ENV ?? 'local';
  if (!['local', 'staging', 'production'].includes(environment)) {
    throw new Error('EXPO_PUBLIC_APP_ENV must be local, staging, or production.');
  }
  const hosted = environment === 'staging' || environment === 'production';
  const key = values.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? values.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (hosted) {
    const missing = [
      !values.EXPO_PUBLIC_SUPABASE_URL && 'EXPO_PUBLIC_SUPABASE_URL',
      !key && 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
      !values.EXPO_PUBLIC_APP_ORIGIN && 'EXPO_PUBLIC_APP_ORIGIN',
      !values.EXPO_PUBLIC_SUPPORT_EMAIL && 'EXPO_PUBLIC_SUPPORT_EMAIL',
    ].filter(Boolean);
    if (missing.length) {
      throw new Error(
        `Missing public configuration for ${environment}: ${missing.join(', ')}. Set these as Vercel Config variables in the deployment's environment/branch before building.`,
      );
    }
  }
  for (const candidate of [
    values.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    values.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  ]) {
    if (!candidate) continue;
    let role: unknown;
    try {
      const payload = candidate.split('.')[1] ?? '';
      const decoded: unknown = JSON.parse(atob(payload.replace(/-/gu, '+').replace(/_/gu, '/')));
      if (decoded && typeof decoded === 'object' && 'role' in decoded) role = decoded.role;
    } catch {
      // Publishable keys are not JWTs. Never include the supplied value in errors.
    }
    if (candidate.startsWith('sb_secret_') || role === 'service_role') {
      throw new Error(
        'A privileged Supabase credential must never be used as public configuration.',
      );
    }
    if (!candidate.startsWith('sb_publishable_') && role !== 'anon') {
      throw new Error('The public Supabase key must be a publishable key or a legacy anon JWT.');
    }
  }
  if (!hosted) return;
  if (
    values.EXPO_PUBLIC_SUPABASE_URL?.replace(/\/$/u, '') !==
    'https://fdovowiihxowzatewxgv.supabase.co'
  ) {
    throw new Error('Staging and production require the approved EXPO_PUBLIC_SUPABASE_URL.');
  }
  try {
    const value = values.EXPO_PUBLIC_APP_ORIGIN!;
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.origin !== value.replace(/\/$/u, '')) throw new Error();
  } catch {
    throw new Error(
      'Staging and production require an HTTPS EXPO_PUBLIC_APP_ORIGIN without a path.',
    );
  }
  const recipients = values
    .EXPO_PUBLIC_SUPPORT_EMAIL!.split(',')
    .map((value) => value.trim().toLowerCase());
  if (
    !recipients.every((value) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/u.test(value)) ||
    !['tymabee@proton.me', 'gt22me@brocku.ca'].every((value) => recipients.includes(value))
  ) {
    throw new Error(
      'EXPO_PUBLIC_SUPPORT_EMAIL must include both Ty and Tarik, separated by commas.',
    );
  }
}
