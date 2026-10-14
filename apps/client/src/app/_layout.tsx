import { Stack, type ErrorBoundaryProps } from 'expo-router';
import { Platform, Pressable, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { SessionProvider } from '@/providers/session-provider';
import { ThemeProvider, useTheme } from '@/providers/theme-provider';
import { usePushRegistration } from '@/hooks/use-push-registration';
import { NotificationsProvider } from '@/providers/notifications-provider';
export function ErrorBoundary({ retry }: ErrorBoundaryProps) {
  return (
    <View
      style={{ flex: 1, padding: 32, gap: 16, backgroundColor: '#fff', justifyContent: 'center' }}
    >
      <Text
        accessibilityRole="header"
        style={{ fontSize: 24, fontWeight: '800', color: '#14213d' }}
      >
        This screen could not load
      </Text>
      <Text style={{ color: '#14213d' }}>
        Your confirmed picks are saved. Try reconnecting to load the latest screen.
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => void retry()}
        style={{ padding: 16, borderWidth: 1, borderColor: '#14213d' }}
      >
        <Text style={{ color: '#14213d' }}>Try again</Text>
      </Pressable>
      {Platform.OS === 'web' ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => window.location.reload()}
          style={{ padding: 16, borderWidth: 1, borderColor: '#14213d' }}
        >
          <Text style={{ color: '#14213d' }}>Reload page</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <SessionProvider>
          <NotificationsProvider>
            <AppRuntime />
          </NotificationsProvider>
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
