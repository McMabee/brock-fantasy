import { useRouter, type Href } from 'expo-router';
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useSession } from '@/providers/session-provider';
import {
  createHeading,
  createShadow,
  radii,
  useAppTheme,
  useThemedStyles,
  type ThemeColors,
} from '@/theme';

export function AppShell({
  children,
  title,
  eyebrow,
  action,
}: {
  children: ReactNode;
  title?: string;
  eyebrow?: string;
  action?: ReactNode;
}) {
  const { width } = useWindowDimensions();
  const router = useRouter();
  const { demoMode } = useSession();
  const { isDark, toggleMode } = useAppTheme();
  const styles = useSharedStyles();
  const wide = width >= 820;

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.backgroundOrbOne} />
      <View style={styles.backgroundOrbTwo} />
      <View style={[styles.topbar, !wide && styles.topbarCompact]}>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel="Brock Fantasy home"
          onPress={() => router.push('/')}
          style={styles.brandRow}
        >
          <View style={styles.brandMark}>
            <Text style={styles.brandMarkText}>B</Text>
          </View>
          <View>
            <Text style={styles.brandName}>BROCK</Text>
            <Text style={styles.brandSub}>FANTASY</Text>
          </View>
        </Pressable>
        <View style={styles.topbarActions}>
          {demoMode && wide ? <Pill label="Demo data" tone="warning" /> : null}
          {wide ? (
            <Pressable accessibilityRole="link" onPress={() => router.push('/dashboard')}>
              <Text style={styles.navLink}>Dashboard</Text>
            </Pressable>
          ) : null}
          <Pressable accessibilityRole="link" onPress={() => router.push('/notifications')}>
            <Text style={styles.navLink}>{wide ? 'Updates' : 'News'}</Text>
          </Pressable>
          <Pressable accessibilityRole="link" onPress={() => router.push('/account')}>
            <Text style={styles.navLink}>{wide ? 'Account' : 'Me'}</Text>
          </Pressable>
          <Pressable
            accessibilityLabel={`Switch to ${isDark ? 'light' : 'dark'} theme`}
            accessibilityRole="button"
            onPress={toggleMode}
            style={({ pressed }) => [styles.themeButton, pressed && styles.buttonPressed]}
          >
            <Text style={styles.themeButtonIcon}>{isDark ? '☀' : '☾'}</Text>
            {wide ? <Text style={styles.themeButtonText}>{isDark ? 'Light' : 'Dark'}</Text> : null}
          </Pressable>
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={[styles.page, wide && styles.pageWide]}>
          {title ? (
            <View style={styles.pageHeading}>
              <View style={styles.pageHeadingCopy}>
                {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
                <Text accessibilityRole="header" style={styles.pageTitle}>
                  {title}
                </Text>
              </View>
              {action}
            </View>
          ) : null}
          {children}
          <View style={styles.footer}>
            <Text style={styles.footerBrand}>BROCK FANTASY</Text>
            <View style={styles.footerLinks}>
              <Pressable accessibilityRole="link" onPress={() => router.push('/privacy')}>
                <Text style={styles.footerLink}>Privacy</Text>
              </Pressable>
              <Pressable accessibilityRole="link" onPress={() => router.push('/terms')}>
                <Text style={styles.footerLink}>Terms</Text>
              </Pressable>
              <Pressable accessibilityRole="link" onPress={() => router.push('/account-deletion')}>
                <Text style={styles.footerLink}>Delete account</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

export function Card({
  children,
  style,
  accent = false,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  accent?: boolean;
}) {
  const styles = useSharedStyles();
  return <View style={[styles.card, accent && styles.cardAccent, style]}>{children}</View>;
}

export function Pill({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: 'neutral' | 'positive' | 'warning' | 'info';
}) {
  const styles = useSharedStyles();
  return (
    <View
      style={[
        styles.pill,
        tone === 'positive' && styles.pillPositive,
        tone === 'warning' && styles.pillWarning,
        tone === 'info' && styles.pillInfo,
      ]}
    >
      <Text style={styles.pillText}>{label}</Text>
    </View>
  );
}

export function ActionButton({
  label,
  href,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
}: {
  label: string;
  href?: Href;
  onPress?: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  disabled?: boolean;
  loading?: boolean;
}) {
  const router = useRouter();
  const { colors } = useAppTheme();
  const styles = useSharedStyles();
  const handlePress = () => {
    if (href) router.push(href);
    else onPress?.();
  };

  return (
    <Pressable
      accessibilityRole={href ? 'link' : 'button'}
      accessibilityState={{ disabled, busy: loading }}
      disabled={disabled || loading}
      onPress={handlePress}
      style={({ pressed }) => [
        styles.button,
        variant === 'secondary' && styles.buttonSecondary,
        variant === 'danger' && styles.buttonDanger,
        variant === 'ghost' && styles.buttonGhost,
        pressed && styles.buttonPressed,
        (disabled || loading) && styles.buttonDisabled,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'secondary' ? colors.text : colors.onBrand} />
      ) : (
        <Text
          style={[
            styles.buttonText,
            variant === 'secondary' && styles.buttonTextSecondary,
            variant === 'ghost' && styles.buttonTextGhost,
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

export function SectionTitle({ title, detail }: { title: string; detail?: string }) {
  const styles = useSharedStyles();
  return (
    <View style={styles.sectionTitleRow}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>
        {title}
      </Text>
      {detail ? <Text style={styles.sectionDetail}>{detail}</Text> : null}
    </View>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  const styles = useSharedStyles();
  return (
    <Card style={styles.emptyState}>
      <Text style={styles.emptyGlyph}>◇</Text>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
    </Card>
  );
}

const createUiStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    body: { color: colors.muted, fontSize: 15, lineHeight: 23 },
    title: { ...createHeading(colors), fontSize: 22 },
    label: { color: colors.text, fontSize: 13, fontWeight: '700' },
    input: {
      backgroundColor: colors.canvasSoft,
      borderColor: colors.border,
      borderRadius: radii.sm,
      borderWidth: 1,
      color: colors.text,
      fontSize: 16,
      minHeight: 50,
      paddingHorizontal: 14,
    },
    row: { flexDirection: 'row', alignItems: 'center' },
    wrap: { flexDirection: 'row', flexWrap: 'wrap' },
    divider: { backgroundColor: colors.border, height: 1 },
  });

export function useUiStyles() {
  return useThemedStyles(createUiStyles);
}

const createSharedStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    safeArea: { flex: 1, overflow: 'hidden', backgroundColor: colors.canvas },
    backgroundOrbOne: {
      position: 'absolute',
      width: 420,
      height: 420,
      borderRadius: 210,
      backgroundColor: colors.orbPrimary,
      opacity: 0.28,
      top: -250,
      right: -100,
    },
    backgroundOrbTwo: {
      position: 'absolute',
      width: 260,
      height: 260,
      borderRadius: 130,
      backgroundColor: colors.orbSecondary,
      opacity: 0.14,
      bottom: -180,
      left: -80,
    },
    topbar: {
      minHeight: 72,
      paddingHorizontal: 24,
      paddingVertical: 12,
      borderBottomColor: colors.topbarBorder,
      borderBottomWidth: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: colors.topbar,
      zIndex: 2,
    },
    topbarCompact: { paddingHorizontal: 12 },
    brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    brandMark: {
      width: 42,
      height: 42,
      borderRadius: 13,
      backgroundColor: colors.brandMark,
      alignItems: 'center',
      justifyContent: 'center',
      transform: [{ rotate: '-4deg' }],
    },
    brandMarkText: { color: colors.white, fontWeight: '900', fontSize: 25 },
    brandName: { color: colors.topbarText, fontWeight: '900', fontSize: 16, letterSpacing: 1.8 },
    brandSub: { color: colors.topbarMuted, fontWeight: '800', fontSize: 9, letterSpacing: 3.1 },
    topbarActions: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: 10,
    },
    navLink: { color: colors.topbarText, fontSize: 14, fontWeight: '700' },
    themeButton: {
      minHeight: 38,
      borderRadius: radii.pill,
      borderColor: colors.topbarMuted,
      borderWidth: 1,
      paddingHorizontal: 11,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
    },
    themeButtonIcon: { color: colors.topbarText, fontSize: 16, lineHeight: 18 },
    themeButtonText: { color: colors.topbarText, fontSize: 11, fontWeight: '800' },
    scrollContent: { flexGrow: 1 },
    page: { width: '100%', maxWidth: 1180, alignSelf: 'center', padding: 20, paddingBottom: 64 },
    pageWide: { paddingHorizontal: 32, paddingTop: 28 },
    pageHeading: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-end',
      gap: 20,
      marginBottom: 24,
    },
    pageHeadingCopy: { flexShrink: 1 },
    eyebrow: {
      color: colors.brand,
      fontSize: 12,
      fontWeight: '800',
      letterSpacing: 1.8,
      textTransform: 'uppercase',
    },
    pageTitle: { ...createHeading(colors), fontSize: 36, marginTop: 5 },
    card: {
      backgroundColor: colors.panel,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: radii.md,
      padding: 18,
      ...createShadow(colors),
    },
    cardAccent: { borderColor: colors.accent, backgroundColor: colors.selected },
    pill: {
      borderRadius: radii.pill,
      backgroundColor: colors.panelStrong,
      paddingHorizontal: 10,
      paddingVertical: 6,
      alignSelf: 'flex-start',
    },
    pillPositive: { backgroundColor: colors.positiveSurface },
    pillWarning: { backgroundColor: colors.warningSurface },
    pillInfo: { backgroundColor: colors.infoSurface },
    pillText: { color: colors.text, fontSize: 11, fontWeight: '800', letterSpacing: 0.3 },
    button: {
      minHeight: 48,
      borderRadius: radii.sm,
      paddingHorizontal: 19,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.brand,
      borderWidth: 1,
      borderColor: colors.brand,
    },
    buttonSecondary: { backgroundColor: colors.panelStrong, borderColor: colors.border },
    buttonDanger: { backgroundColor: colors.danger, borderColor: colors.danger },
    buttonGhost: { backgroundColor: 'transparent', borderColor: 'transparent' },
    buttonPressed: { opacity: 0.78, transform: [{ scale: 0.985 }] },
    buttonDisabled: { opacity: 0.5 },
    buttonText: { color: colors.onBrand, fontWeight: '900', fontSize: 14 },
    buttonTextSecondary: { color: colors.text },
    buttonTextGhost: { color: colors.brand },
    sectionTitleRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'baseline',
      gap: 12,
      marginTop: 30,
      marginBottom: 14,
    },
    sectionTitle: { ...createHeading(colors), fontSize: 22 },
    sectionDetail: { color: colors.muted, fontSize: 13 },
    emptyState: { alignItems: 'center', paddingVertical: 38 },
    emptyGlyph: { color: colors.brand, fontSize: 34 },
    emptyTitle: { ...createHeading(colors), fontSize: 20, marginTop: 8 },
    emptyBody: {
      color: colors.muted,
      fontSize: 14,
      textAlign: 'center',
      marginTop: 8,
      maxWidth: 420,
    },
    footer: {
      borderTopColor: colors.border,
      borderTopWidth: 1,
      marginTop: 60,
      paddingTop: 22,
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 16,
    },
    footerBrand: { color: colors.muted, fontSize: 9, fontWeight: '900', letterSpacing: 1.8 },
    footerLinks: { flexDirection: 'row', flexWrap: 'wrap', gap: 18 },
    footerLink: { color: colors.muted, fontSize: 11, fontWeight: '700' },
  });

const useSharedStyles = () => useThemedStyles(createSharedStyles);
