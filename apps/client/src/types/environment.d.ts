declare namespace NodeJS {
  interface ProcessEnv {
    EXPO_PUBLIC_SUPABASE_URL?: string;
    /** Supabase publishable key. The deprecated anon name remains for migration only. */
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
    EXPO_PUBLIC_SUPABASE_ANON_KEY?: string;
    EXPO_PUBLIC_APP_ENV?: 'local' | 'staging' | 'production';
    EXPO_PUBLIC_APP_ORIGIN?: string;
    EXPO_PUBLIC_SUPPORT_EMAIL?: string;
    RESEND_API_KEY?: string;
    ADMIN_INVITE_EMAIL_FROM?: string;
  }
}
