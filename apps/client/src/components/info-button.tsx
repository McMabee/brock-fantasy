import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ViewportPortal } from './viewport-portal';
import { PressableLink } from './pressable-link';
import { Modal, Platform, Pressable, Text, View } from 'react-native';
import { useThemeColors } from '@/providers/theme-provider';

const definitions: Record<string, { title: string; body: string; section: string }> = {
  adp: {
    title: 'Average draft position',
    body: 'The average overall pick used to draft this athlete, combining the preseason starting observation with completed, unvoided drafts across leagues. Lower means usually picked earlier.',
    section: 'stats',
  },
  projection: {
    title: 'Projected fantasy points',
    body: 'An estimate, not earned points. Each game uses projected season points divided by projected games. Period estimates follow scheduled games; pending schedules and missing inputs are identified.',
    section: 'stats',
  },
  points: {
    title: 'Fantasy points',
    body: 'Points calculated from published sport statistics using the league scoring rules. Only eligible game-start starters earn team points; bench games do not score.',
    section: 'scoring',
  },
  positions: {
    title: 'Positions and FLEX',
    body: 'Each starter spot accepts its listed positions. FLEX accepts any eligible athlete from any sport or position. Bench athletes are reserves and do not earn team points.',
    section: 'rosters',
  },
  locks: {
    title: 'Game locks',
    body: 'An athlete locks at scheduled game start and unlocks when the game is finished. Saved changes affect future games; previously earned points stay with the team that earned them.',
    section: 'lineups',
  },
  waivers: {
    title: 'Waiver claims',
    body: 'Dropped athletes enter a 24-hour waiver window. Submitting a claim is a request, not an acquisition. Claims settle using the existing priority rules, and My claims shows the outcome.',
    section: 'transactions',
  },
  trades: {
    title: 'Trade status',
    body: 'A proposal needs the other manager’s acceptance, then a 24-hour review. Acceptance does not move athletes immediately. Execution can wait for a game lock or fail if ownership or eligibility changes.',
    section: 'transactions',
  },
};
export function InfoButton({
  topic,
  title,
  body,
}: {
  topic?: string;
  title?: string;
  body?: string;
}) {
  const definition = definitions[topic ?? ''] ?? {
    title: title ?? 'Statistic',
    body: body ?? 'See the scoring rules for this statistic.',
    section: 'scoring',
  };
  const colors = useThemeColors();
  const [open, setOpen] = useState(false);
  const id = useId();
  const anchor = useRef<View>(null);
  const trigger = useRef<View>(null);
  const suppressFocus = useRef(false);
  const [portalHost, setPortalHost] = useState<Element | null>(null);
  const [placement, setPlacement] = useState({ top: 0, left: 0 });
  const reveal = () => {
    if (Platform.OS !== 'web') {
      setOpen(true);
      return;
    }
    // - Keep definitions inside their dialog's stacking layer and keyboard focus boundary
    setPortalHost(
      (anchor.current as unknown as HTMLElement | null)?.closest('[aria-modal="true"]') ?? null,
    );
    anchor.current?.measureInWindow((x, y, _width, height) =>
      setPlacement({
        top: Math.min(y + height + 4, Math.max(8, window.innerHeight - 330)),
        left: Math.max(8, Math.min(x, window.innerWidth - 350)),
      }),
    );
    setOpen(true);
  };
  const dismiss = useCallback((restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus && Platform.OS === 'web') {
      suppressFocus.current = true;
      (trigger.current as unknown as HTMLElement | null)?.focus();
      suppressFocus.current = false;
    }
  }, []);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  };
  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );
  useEffect(() => {
    if (!open || Platform.OS !== 'web') return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        dismiss(true);
      }
    };
    // - Consume Escape before the enclosing React Native dialog handles its keyup
    document.addEventListener('keyup', handler, true);
    return () => document.removeEventListener('keyup', handler, true);
  }, [open, dismiss]);
  const content = (
    <View
      nativeID={id}
      onLayout={(event) => {
        if (Platform.OS !== 'web') return;
        const height = event.nativeEvent.layout.height;
        setPlacement((current) => ({
          ...current,
          top: Math.max(8, Math.min(current.top, window.innerHeight - height - 8)),
        }));
      }}
      onPointerEnter={cancelClose}
      style={{
        width: '100%',
        maxWidth: 430,
        padding: 22,
        gap: 14,
        backgroundColor: colors.canvasSoft,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: colors.border,
      }}
    >
      <Text
        accessibilityRole="header"
        style={{ color: colors.text, fontFamily: 'Inter', fontSize: 20, fontWeight: '700' }}
      >
        {title ?? definition.title}
      </Text>
      <Text
        accessibilityLiveRegion="polite"
        style={{ color: colors.text, fontFamily: 'Inter', lineHeight: 24 }}
      >
        {body ?? definition.body}
      </Text>
      <PressableLink
        href={{ pathname: '/rules', params: { section: definition.section } }}
        accessibilityRole="link"
        onPress={() => {
          setOpen(false);
        }}
        style={{ minHeight: 44, justifyContent: 'center' }}
      >
        <Text style={{ color: colors.text, textDecorationLine: 'underline' }}>Full rules</Text>
      </PressableLink>
      <Pressable
        accessibilityRole="button"
        onPress={() => dismiss(true)}
        style={{ minHeight: 44, justifyContent: 'center' }}
      >
        <Text style={{ color: colors.text }}>Close</Text>
      </Pressable>
    </View>
  );
  return (
    <View ref={anchor} style={{ alignSelf: 'flex-start' }}>
      <Pressable
        ref={trigger}
        accessibilityRole="button"
        accessibilityLabel={`About ${title ?? definition.title}`}
        accessibilityState={{ expanded: open }}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onPress={reveal}
        onHoverIn={() => {
          cancelClose();
          reveal();
        }}
        onFocus={() => {
          if (!suppressFocus.current) reveal();
        }}
        style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}
      >
        <Text style={{ color: colors.text, fontFamily: 'Inter', fontSize: 19 }}>ⓘ</Text>
      </Pressable>
      {Platform.OS === 'web' ? (
        open && typeof document !== 'undefined' ? (
          <ViewportPortal container={portalHost}>
            <View
              style={{ position: 'fixed' as 'absolute', inset: 0, zIndex: 2000 }}
              pointerEvents="box-none"
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Dismiss definition"
                onPress={() => setOpen(false)}
                style={{ position: 'absolute', inset: 0 }}
              />
              <View
                style={{
                  position: 'absolute',
                  top: placement.top,
                  left: placement.left,
                  width: Math.min(342, window.innerWidth - 16),
                }}
              >
                {content}
              </View>
            </View>
          </ViewportPortal>
        ) : null
      ) : (
        <Modal
          visible={open}
          transparent
          animationType="none"
          onRequestClose={() => setOpen(false)}
        >
          <View
            style={{
              flex: 1,
              justifyContent: 'center',
              alignItems: 'center',
              padding: 16,
              backgroundColor: '#0006',
            }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Dismiss definition"
              onPress={() => setOpen(false)}
              style={{ position: 'absolute', inset: 0 }}
            />
            {content}
          </View>
        </Modal>
      )}
    </View>
  );
}
