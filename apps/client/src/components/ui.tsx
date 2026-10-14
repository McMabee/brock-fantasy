import { useResponsiveDimensions as useWindowDimensions } from '@/hooks/use-responsive-dimensions';
import { Link, usePathname, useRouter, type Href } from 'expo-router';
import { useEffect, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import darkLogo from '../../assets/brock-fantasy-logo.png';
import lightLogo from '../../assets/brock-fantasy-logo-light.png';
import { ASSOCIATION_INSTAGRAM_URL } from '@/lib/association';
import { useSession } from '@/providers/session-provider';
import { useTheme, useThemedStyles, useThemeColors } from '@/providers/theme-provider';
import { colors, fonts, heading, radii, shadow } from '@/theme';
import { useNotifications } from '@/hooks/use-notifications';

export function AppShell({
  children,
  title,
  eyebrow,
  action,
  workspace = false,
}: {
  children: ReactNode;
  title?: string;
  eyebrow?: string;
  action?: ReactNode;
  workspace?: boolean;
}) {
  const styles = useThemedStyles(createStyles);
  const colors = useThemeColors();
  const { width } = useWindowDimensions();
  const router = useRouter();
  const pathname = usePathname();
  const { user, error: sessionError } = useSession();
  const { unreadCount } = useNotifications();
  const { mode, toggleMode, palette } = useTheme();
  useEffect(() => {
    if (typeof document !== 'undefined')
      document.title = title ? `${title} | Brock Fantasy` : 'Brock Fantasy';
  }, [title]);
  const wide = width >= 1024;
  const navigation = [
    {
      label: 'Home',
      href: '/dashboard',
      icon: '⌂',
      active:
        pathname === '/dashboard' ||
        pathname === '/' ||
        /^\/(league|draft|lineup|lineup-beta|transactions|commissioner|leagues)\//u.test(pathname),
    },
    { label: 'Players', href: '/players', icon: '☷', active: pathname.startsWith('/players') },
    {
      label: 'Notifications',
      href: '/notifications',
      icon: '◉',
      active: pathname === '/notifications',
    },
    {
      label: 'Account',
      href: user ? '/account' : '/auth',
      icon: '◎',
      active: ['/account', '/auth', '/mfa'].includes(pathname),
    },
  ] as const;
  const navItems = navigation.map((item) => (
    <Pressable
      key={item.label}
      accessibilityRole="link"
      accessibilityLabel={
        item.label +
        (item.label === 'Notifications' && unreadCount ? `, ${unreadCount} unread` : '')
      }
      onPress={() => router.push(item.href)}
      style={({ pressed }) => [
        styles.navItem,
        wide ? styles.navItemWide : styles.navItemMobile,
        item.active && styles.navActive,
        pressed && { opacity: 0.7 },
      ]}
    >
      <Text accessible={false} style={[styles.navIcon, item.active && styles.navSelected]}>
        {item.icon}
      </Text>
      <Text
        numberOfLines={1}
        style={[styles.navLabel, !wide && styles.navLabelMobile, item.active && styles.navSelected]}
      >
        {item.label}
      </Text>
      {wide && item.label === 'Notifications' && unreadCount > 0 ? (
        <Text style={styles.unread}>{unreadCount}</Text>
      ) : null}
    </Pressable>
  ));
  const brand = (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel="Brock Fantasy home"
      onPress={() => router.push(user ? '/dashboard' : '/')}
      style={styles.brandRow}
    >
      <Image
        accessibilityLabel="Brock Fantasy logo"
        resizeMode="contain"
        source={mode === 'dark' ? darkLogo : lightLogo}
        style={styles.logo}
      />
      <View>
        <Text style={styles.brandTitle}>BROCK</Text>
        <Text style={styles.brandSubtitle}>FANTASY</Text>
      </View>
    </Pressable>
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.appFrame}>
        {wide ? (
          <View style={styles.sidebar}>
            {brand}
            <Text style={styles.navCaption}>YOUR WORKSPACE</Text>
            <View style={styles.sidebarLinks}>{navItems}</View>
            <View style={styles.sidebarFoot}>
              <Pill label="2026–27 SEASON" tone="info" />
              <Text style={styles.sidebarNote}>Six programs. One competition.</Text>
            </View>
          </View>
        ) : null}
        <View style={styles.mainFrame}>
          <View style={styles.topbar}>
            {wide ? (
              <View>
                <Text style={styles.topbarTitle}>BROCK FANTASY</Text>
                <Text style={styles.sidebarNote}>Your season starts here.</Text>
              </View>
            ) : (
              brand
            )}
            <View style={styles.topbarActions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Switch to ${mode === 'dark' ? 'light' : 'dark'} mode`}
                onPress={toggleMode}
                style={[
                  styles.themeToggle,
                  { borderColor: palette.border, backgroundColor: palette.canvasSoft },
                ]}
              >
                <Text style={[styles.themeToggleText, { color: palette.text }]}>
                  {mode === 'dark' ? '☀ Light' : '☾ Dark'}
                </Text>
              </Pressable>
              {wide ? (
                <Pressable
                  accessibilityRole="link"
                  style={{ minHeight: 44, justifyContent: 'center' }}
                  onPress={() => router.push(user ? '/account' : '/auth')}
                >
                  <Text style={styles.navLink}>{user ? 'Account' : 'Sign in'}</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
          <ScrollView contentContainerStyle={styles.scrollContent}>
            <View
              key={pathname}
              dataSet={{ bfPage: 'true' }}
              style={[styles.page, wide && styles.pageWide, workspace && styles.workspacePage]}
            >
              {sessionError ? (
                <Text accessibilityRole="alert" style={{ color: colors.danger }}>
                  {sessionError}
                </Text>
              ) : null}
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
                  <Pressable
                    accessibilityRole="link"
                    style={{ minHeight: 44, justifyContent: 'center' }}
                    onPress={() => router.push('/privacy')}
                  >
                    <Text style={styles.footerLink}>Privacy</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="link"
                    style={{ minHeight: 44, justifyContent: 'center' }}
                    onPress={() => router.push('/terms')}
                  >
                    <Text style={styles.footerLink}>Terms</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="link"
                    style={{ minHeight: 44, justifyContent: 'center' }}
                    onPress={() => router.push('/account-deletion')}
                  >
                    <Text style={styles.footerLink}>Delete account</Text>
                  </Pressable>
                  <Link
                    href={ASSOCIATION_INSTAGRAM_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    accessibilityRole="link"
                    accessibilityLabel="Brock Fantasy Association on Instagram: @therealbrockfantasy"
                    style={styles.footerLink}
                  >
                    Association Instagram
                  </Link>
                </View>
              </View>
            </View>
          </ScrollView>
        </View>
      </View>
      {!wide ? <View style={styles.bottomNav}>{navItems}</View> : null}
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
  const styles = useThemedStyles(createStyles);
  return <View style={[styles.card, accent && styles.cardAccent, style]}>{children}</View>;
}

export function LoadingState({ label = 'Loading', rows = 3 }: { label?: string; rows?: number }) {
  const styles = useThemedStyles(createStyles);
  const uiStyles = useUiStyles();
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityState={{ busy: true }}
      style={{ gap: 12 }}
    >
      <Text style={uiStyles.body}>{label}…</Text>
      {Array.from({ length: rows }, (_, index) => (
        <View key={index} dataSet={{ bfSkeleton: 'true' }} style={styles.skeletonRow}>
          <View style={styles.skeletonPhoto} />
          <View style={{ flex: 1, gap: 10 }}>
            <View style={styles.skeletonLine} />
            <View style={[styles.skeletonLine, { width: '55%', height: 8 }]} />
          </View>
        </View>
      ))}
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const uiStyles = useUiStyles();
  return (
    <Card style={{ gap: 12 }}>
      <Text accessibilityRole="alert" style={uiStyles.body}>
        {message}
      </Text>
      {onRetry ? <ActionButton label="Try again" onPress={onRetry} variant="secondary" /> : null}
    </Card>
  );
}

export function Pill({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: 'neutral' | 'positive' | 'warning' | 'info';
}) {
  const styles = useThemedStyles(createStyles);
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
  const styles = useThemedStyles(createStyles);
  const colors = useThemeColors();
  const router = useRouter();
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
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        {loading ? (
          <ActivityIndicator
            size="small"
            color={variant === 'primary' || variant === 'danger' ? colors.white : colors.text}
          />
        ) : null}
        <Text
          style={[
            styles.buttonText,
            (variant === 'secondary' || variant === 'ghost') && { color: colors.text },
          ]}
        >
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

export function SectionTitle({ title, detail }: { title: string; detail?: string }) {
  const styles = useThemedStyles(createStyles);
  const { width } = useWindowDimensions();
  return (
    <View
      style={[
        styles.sectionTitleRow,
        width < 600 && { flexDirection: 'column', alignItems: 'flex-start', gap: 6 },
      ]}
    >
      <Text accessibilityRole="header" style={styles.sectionTitle}>
        {title}
      </Text>
      {detail ? <Text style={styles.sectionDetail}>{detail}</Text> : null}
    </View>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  const styles = useThemedStyles(createStyles);
  return (
    <Card style={styles.emptyState}>
      <Text style={styles.emptyGlyph}>◇</Text>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
    </Card>
  );
}

export const createUiStyles = (colors: ReturnType<typeof useThemeColors>) =>
  StyleSheet.create({
    body: { color: colors.muted, fontFamily: fonts.body, fontSize: 15, lineHeight: 23 },
    link: { color: colors.link, textDecorationLine: 'underline' },
    title: { ...heading, fontSize: 22, color: colors.text },
    label: { fontFamily: 'Inter', color: colors.text, fontSize: 13, fontWeight: '700' },
    input: {
      backgroundColor: colors.canvasSoft,
      borderColor: colors.border,
      borderRadius: radii.sm,
      borderWidth: 1,
      color: colors.text,
      fontFamily: fonts.body,
      fontSize: 16,
      minHeight: 50,
      paddingHorizontal: 14,
    },
    row: { flexDirection: 'row', alignItems: 'center' },
    wrap: { flexDirection: 'row', flexWrap: 'wrap' },
    divider: { backgroundColor: colors.border, height: 1 },
  });
export const uiStyles = createUiStyles(colors);
export function useUiStyles() {
  return useThemedStyles(createUiStyles);
}

const createStyles = (colors: ReturnType<typeof useThemeColors>) =>
  StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: colors.canvas },
    appFrame: { flex: 1, flexDirection: 'row', minHeight: 0 },
    mainFrame: { flex: 1, minWidth: 0, minHeight: 0 },
    sidebar: {
      width: 208,
      padding: 20,
      backgroundColor: colors.canvasSoft,
      borderRightColor: colors.border,
      borderRightWidth: 1,
      gap: 16,
    },
    sidebarLinks: { gap: 8 },
    sidebarFoot: { marginTop: 'auto', gap: 12, paddingTop: 32 },
    sidebarNote: { fontFamily: 'Inter', color: colors.muted, fontSize: 11, lineHeight: 18 },
    navCaption: {
      fontFamily: 'Inter',
      color: colors.muted,
      fontSize: 10,
      fontWeight: '700',
      letterSpacing: 1.6,
      marginTop: 38,
    },
    navItem: { minHeight: 48, alignItems: 'center', gap: 12, borderRadius: 12 },
    navItemWide: { flexDirection: 'row', paddingHorizontal: 12 },
    navItemMobile: { flex: 1, minWidth: 0, justifyContent: 'center', gap: 3, paddingVertical: 7 },
    navActive: { backgroundColor: colors.panelStrong },
    navSelected: { color: colors.white },
    navIcon: { fontFamily: 'Inter', color: colors.muted, fontSize: 22 },
    navLabel: { fontFamily: 'Inter', color: colors.muted, fontSize: 13, fontWeight: '700' },
    navLabelMobile: { fontFamily: 'Inter', fontSize: 10 },
    unread: { fontFamily: 'Inter', color: colors.white, fontSize: 11, marginLeft: 'auto' },
    bottomNav: {
      flexDirection: 'row',
      backgroundColor: colors.topbar,
      borderTopColor: colors.border,
      borderTopWidth: 1,
      padding: 8,
      paddingBottom: 8,
    },
    brandTitle: { ...heading, fontSize: 24, lineHeight: 26, color: colors.text },
    brandSubtitle: {
      fontFamily: 'Inter',
      color: colors.muted,
      fontWeight: '700',
      fontSize: 9,
      letterSpacing: 2.3,
    },
    topbarTitle: { ...heading, fontSize: 22, color: colors.text },
    workspacePage: { maxWidth: 1800 },
    skeletonRow: {
      flexDirection: 'row',
      gap: 16,
      alignItems: 'center',
      borderRadius: 16,
      backgroundColor: colors.panel,
      padding: 20,
      minHeight: 94,
    },
    skeletonPhoto: { width: 44, height: 44, backgroundColor: colors.border, borderRadius: 10 },
    skeletonLine: { height: 12, width: '75%', borderRadius: 6, backgroundColor: colors.border },
    backgroundOrbOne: {
      position: 'absolute',
      width: 420,
      height: 420,
      borderRadius: 210,
      backgroundColor: colors.navy,
      opacity: 0.08,
      top: -250,
      right: -100,
    },
    backgroundOrbTwo: {
      position: 'absolute',
      width: 260,
      height: 260,
      borderRadius: 130,
      backgroundColor: colors.red,
      opacity: 0.06,
      bottom: -180,
      left: -80,
    },
    topbar: {
      minHeight: 80,
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomColor: colors.border,
      borderBottomWidth: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: colors.topbar,
      zIndex: 2,
    },
    brandRow: { flexDirection: 'row', gap: 10, alignItems: 'center', minHeight: 44 },
    logo: { width: 38, height: 44 },
    topbarActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    themeToggle: {
      borderWidth: 1,
      borderRadius: radii.pill,
      paddingHorizontal: 10,
      paddingVertical: 7,
      minHeight: 44,
      minWidth: 70,
      alignItems: 'center',
      justifyContent: 'center',
    },
    themeToggleText: { fontFamily: 'Inter', fontSize: 11, fontWeight: '800' },
    navLink: { fontFamily: 'Inter', color: colors.text, fontSize: 14, fontWeight: '700' },
    scrollContent: { flexGrow: 1 },
    page: { width: '100%', maxWidth: 1180, alignSelf: 'center', padding: 16, paddingBottom: 32 },
    pageWide: { paddingHorizontal: 32, paddingTop: 32 },
    pageHeading: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
      alignItems: 'flex-end',
      gap: 20,
      marginBottom: 24,
    },
    pageHeadingCopy: { flexShrink: 1 },
    eyebrow: {
      fontFamily: 'Inter',
      color: colors.text,
      fontSize: 12,
      fontWeight: '800',
      letterSpacing: 1.8,
      textTransform: 'uppercase',
    },
    pageTitle: { ...heading, fontSize: 36, marginTop: 5, color: colors.text },
    card: {
      backgroundColor: colors.panel,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: radii.md,
      padding: 18,
      ...shadow,
    },
    cardAccent: { borderColor: colors.red, backgroundColor: colors.panel },
    pill: {
      borderRadius: radii.pill,
      backgroundColor: colors.panelStrong,
      paddingHorizontal: 10,
      paddingVertical: 6,
      alignSelf: 'flex-start',
    },
    pillPositive: { backgroundColor: colors.navy },
    pillWarning: { backgroundColor: colors.navy, borderColor: colors.red, borderWidth: 1 },
    pillInfo: { backgroundColor: colors.navy },
    pillText: {
      fontFamily: 'Inter',
      color: colors.white,
      fontSize: 11,
      fontWeight: '800',
      letterSpacing: 0.3,
    },
    button: {
      minHeight: 48,
      borderRadius: radii.sm,
      paddingHorizontal: 19,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.red,
      borderWidth: 1,
      borderColor: colors.red,
    },
    buttonSecondary: { backgroundColor: colors.canvasSoft, borderColor: colors.border },
    buttonDanger: { backgroundColor: colors.red, borderColor: colors.red },
    buttonGhost: { backgroundColor: 'transparent', borderColor: 'transparent' },
    buttonPressed: { opacity: 0.78, transform: [{ scale: 0.985 }] },
    buttonDisabled: { opacity: 0.5 },
    buttonText: { fontFamily: 'Inter', color: colors.white, fontWeight: '700', fontSize: 19 },
    sectionTitleRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'baseline',
      gap: 12,
      marginTop: 30,
      marginBottom: 14,
    },
    sectionTitle: { ...heading, fontSize: 22, color: colors.text },
    sectionDetail: { fontFamily: 'Inter', color: colors.muted, fontSize: 13 },
    emptyState: { alignItems: 'center', paddingVertical: 38 },
    emptyGlyph: { fontFamily: 'Inter', color: colors.text, fontSize: 34 },
    emptyTitle: { ...heading, fontSize: 20, marginTop: 8, color: colors.text },
    emptyBody: {
      fontFamily: 'Inter',
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
    footerBrand: {
      fontFamily: 'Inter',
      color: colors.muted,
      fontSize: 9,
      fontWeight: '900',
      letterSpacing: 1.8,
    },
    footerLinks: { flexDirection: 'row', flexWrap: 'wrap', gap: 18 },
    footerLink: {
      fontFamily: 'Inter',
      color: colors.link,
      fontSize: 11,
      fontWeight: '700',
      textDecorationLine: 'underline',
    },
  });
