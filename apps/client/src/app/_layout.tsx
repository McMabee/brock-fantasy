import { Stack, type ErrorBoundaryProps } from 'expo-router';
import { Platform, Pressable, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import interFont from '../../assets/fonts/Inter.ttf';
import displayFont from '../../assets/fonts/BarlowCondensed-Bold.ttf';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { colors, heading } from '@/theme';

import { SessionProvider } from '@/providers/session-provider';
import { ThemeProvider, useTheme } from '@/providers/theme-provider';
import { usePushRegistration } from '@/hooks/use-push-registration';
import { NotificationsProvider } from '@/providers/notifications-provider';
export function ErrorBoundary({ retry }: ErrorBoundaryProps) {
  return (
    <View
      style={{
        flex: 1,
        padding: 32,
        gap: 16,
        backgroundColor: colors.canvas,
        justifyContent: 'center',
      }}
    >
      <Text accessibilityRole="header" style={{ ...heading, fontSize: 28 }}>
        This screen could not load
      </Text>
      <Text style={{ color: colors.muted }}>
        Your confirmed picks are saved. Try reconnecting to load the latest screen.
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => void retry()}
        style={{
          padding: 16,
          minHeight: 48,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 12,
        }}
      >
        <Text style={{ color: colors.text }}>Try again</Text>
      </Pressable>
      {Platform.OS === 'web' ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => window.location.reload()}
          style={{
            padding: 16,
            minHeight: 48,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 12,
          }}
        >
          <Text style={{ color: colors.text }}>Reload page</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(
    Platform.OS === 'web' ? {} : { Inter: interFont, BarlowCondensed: displayFont },
  );
  if (!fontsLoaded && !fontError)
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: '#000000',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ color: '#FFFFFF' }}>Loading Brock Fantasy…</Text>
      </View>
    );
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
  const reducedMotion = useReducedMotion();
  return (
    <>
      <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: palette.canvas },
          animation: reducedMotion ? 'none' : 'fade',
        }}
      />
    </>
  );
}
