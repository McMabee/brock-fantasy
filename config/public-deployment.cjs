const defaults = require('./public-web.json');

// - Share browser-safe defaults across the export, routing middleware and API adapter
// - Leave local dotenv configuration and all server credentials untouched
exports.resolvePublicDeploymentConfig = (env) => {
  if (env.VERCEL !== '1') return {};
  if (env.VERCEL_ENV === 'preview') {
    const origin = env.EXPO_PUBLIC_APP_ORIGIN;
    const registration = env.PUBLIC_REGISTRATION_ORIGIN;
    const database = env.EXPO_PUBLIC_SUPABASE_URL;
    const liveOrigins = new Set([
      'https://play.brockfantasy.ca',
      'https://beta.brockfantasy.ca',
      'https://www.brockfantasy.ca',
      'https://brockfantasy.ca',
    ]);
    const isolatedOrigin = (value) => {
      try {
        const parsed = new URL(value);
        return (
          parsed.protocol === 'https:' &&
          parsed.origin === value &&
          !parsed.username &&
          !parsed.password &&
          !liveOrigins.has(value)
        );
      } catch {
        return false;
      }
    };
    // - Fail before export or runtime requests can inherit the live project defaults
    if (
      env.BROCK_PREVIEW_ISOLATED !== 'true' ||
      !isolatedOrigin(origin) ||
      !isolatedOrigin(registration) ||
      origin === registration ||
      !database ||
      database === defaults.EXPO_PUBLIC_SUPABASE_URL ||
      !/^https:\/\/[a-z]{20}\.supabase\.co$/u.test(database) ||
      !(env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.EXPO_PUBLIC_SUPABASE_ANON_KEY) ||
      env.EXPO_PUBLIC_APP_ENV !== 'staging'
    )
      throw new Error(
        'Preview deployments require explicit isolated app, association and Supabase configuration',
      );
  }
  const branch = env.VERCEL_GIT_COMMIT_REF;
  const environment =
    env.EXPO_PUBLIC_APP_ENV ||
    (branch === 'main' || (branch !== 'beta' && env.VERCEL_ENV === 'production')
      ? 'production'
      : 'staging');
  return {
    EXPO_PUBLIC_APP_ENV: environment,
    EXPO_PUBLIC_SUPABASE_URL: env.EXPO_PUBLIC_SUPABASE_URL || defaults.EXPO_PUBLIC_SUPABASE_URL,
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
      defaults.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    EXPO_PUBLIC_APP_ORIGIN:
      env.EXPO_PUBLIC_APP_ORIGIN ||
      (environment === 'production'
        ? 'https://play.brockfantasy.ca'
        : 'https://beta.brockfantasy.ca'),
    EXPO_PUBLIC_SUPPORT_EMAIL: env.EXPO_PUBLIC_SUPPORT_EMAIL || defaults.EXPO_PUBLIC_SUPPORT_EMAIL,
  };
};
