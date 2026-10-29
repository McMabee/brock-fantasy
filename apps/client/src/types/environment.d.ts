declare namespace NodeJS {
  interface ProcessEnv {
    EXPO_PUBLIC_SUPABASE_URL?: string;
    /** Supabase publishable key. The deprecated anon name remains for migration only. */
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
    EXPO_PUBLIC_SUPABASE_ANON_KEY?: string;
    EXPO_PUBLIC_APP_ENV?: 'local' | 'staging' | 'production';
    EXPO_PUBLIC_DEPLOYMENT_TARGET?: 'preview';
    EXPO_PUBLIC_APP_ORIGIN?: string;
    EXPO_PUBLIC_SUPPORT_EMAIL?: string;
    RESEND_API_KEY?: string;
    ADMIN_INVITE_EMAIL_FROM?: string;
    SERVICE_EMAIL_FROM?: string;
    SERVICE_EMAIL_WORKER_SECRET?: string;
    SERVICE_EMAIL_UNSUBSCRIBE_SECRET?: string;
    RESEND_WEBHOOK_SECRET?: string;
    SUPPORT_EMAIL_TO?: string;
    SUPABASE_SECRET_KEY?: string;
    PUBLIC_REGISTRATION_ORIGIN?: string;
  }
}
