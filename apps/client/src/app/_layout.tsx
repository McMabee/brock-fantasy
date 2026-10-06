import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { SessionProvider } from '@/providers/session-provider';
import { ThemeProvider, useTheme } from '@/providers/theme-provider';
import { usePushRegistration } from '@/hooks/use-push-registration';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <SessionProvider>
          <AppRuntime />
        </SessionProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function AppRuntime() {
  usePushRegistration();
  const { mode, palette } = useTheme();
  return (
    <>
      <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: palette.canvas },
          animation: 'fade',
        }}
      />
    </>
  );
}
