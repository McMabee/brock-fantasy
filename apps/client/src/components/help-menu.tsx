import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { HELP_LINKS } from '@/lib/help-navigation';
import { useThemeColors } from '@/providers/theme-provider';

export function HelpMenu() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const right = 16 + insets.right;
  const top = 96 + insets.top;
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Help and support"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(true)}
        style={{
          width: 44,
          height: 44,
          borderRadius: 22,
          backgroundColor: '#B00020',
          borderWidth: 2,
          borderColor: '#FFFFFF',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 100,
        }}
      >
        <Text
          accessible={false}
          style={{ color: '#FFFFFF', fontFamily: 'Inter', fontSize: 26, fontWeight: '700' }}
        >
          ?
        </Text>
      </Pressable>
      <Modal
        visible={open}
        transparent
        animationType="none"
        accessibilityLabel="Help and support"
        onRequestClose={() => setOpen(false)}
      >
        <View style={{ flex: 1 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close help options"
            onPress={() => setOpen(false)}
            style={{ position: 'absolute', inset: 0 }}
          />
          <ScrollView
            accessibilityLabel="Help and support options"
            style={{
              position: 'absolute',
              right,
              top,
              width: Math.min(280, width - right - 16 - insets.left),
              maxHeight: Math.max(48, height - top - 24 - insets.bottom),
              backgroundColor: colors.panel,
              borderColor: colors.border,
              borderWidth: 1,
              borderRadius: 16,
            }}
            contentContainerStyle={{ padding: 8, gap: 4 }}
          >
            {HELP_LINKS.map((link) => (
              <Pressable
                key={link.href}
                accessibilityRole="link"
                onPress={() => {
                  setOpen(false);
                  router.push(link.href);
                }}
                style={({ pressed }) => ({
                  minHeight: 48,
                  paddingHorizontal: 14,
                  paddingVertical: 12,
                  borderRadius: 10,
                  justifyContent: 'center',
                  backgroundColor: pressed ? colors.canvasSoft : colors.panel,
                })}
              >
                <Text
                  style={{
                    color: colors.text,
                    fontFamily: 'Inter',
                    fontSize: 15,
                    fontWeight: '600',
                    lineHeight: 22,
                  }}
                >
                  {link.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}
