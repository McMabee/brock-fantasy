import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { SessionProvider } from '@/providers/session-provider';
import { usePushRegistration } from '@/hooks/use-push-registration';
import { AppThemeProvider, useAppTheme } from '@/theme';

export default function RootLayout() {
  return (
    <AppThemeProvider>
      <SafeAreaProvider>
        <SessionProvider>
          <AppRuntime />
        </SessionProvider>
      </SafeAreaProvider>
    </AppThemeProvider>
  );
}

function AppRuntime() {
  usePushRegistration();
  const { colors, isDark } = useAppTheme();
  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.canvas },
          animation: 'fade',
        }}
      />
    </>
  );
}
