const defaults = require('./public-web.json');

// - Share browser-safe defaults across the export, routing middleware and API adapter
// - Leave local dotenv configuration and all server credentials untouched
exports.resolvePublicDeploymentConfig = (env) => {
  if (env.VERCEL !== '1') return {};
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
