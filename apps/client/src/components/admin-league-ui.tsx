import { Pressable, Text, View } from 'react-native';
import { ActionButton, ErrorState, useUiStyles } from '@/components/ui';
import { useThemeColors } from '@/providers/theme-provider';
import { adminDate } from '@/lib/admin-leagues';

export function LeagueChoices({
  label,
  choices,
  selected,
  onSelect,
}: {
  label: string;
  choices: readonly { value: string; label: string }[];
  selected: string;
  onSelect: (value: string) => void;
}) {
  const ui = useUiStyles();
  const colors = useThemeColors();
  return (
    <View style={{ gap: 8 }}>
      <Text accessibilityRole="header" style={ui.label}>
        {label}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {choices.map((choice) => (
          <Pressable
            key={choice.value}
            accessibilityRole="button"
            accessibilityLabel={`${label}: ${choice.label}`}
            accessibilityState={{ selected: selected === choice.value }}
            onPress={() => onSelect(choice.value)}
            style={{
              minHeight: 44,
              justifyContent: 'center',
              paddingHorizontal: 14,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: selected === choice.value ? colors.red : colors.border,
              backgroundColor: selected === choice.value ? colors.canvasSoft : colors.panel,
            }}
          >
            <Text style={[ui.body, { fontWeight: selected === choice.value ? '800' : '400' }]}>
              {choice.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export function LeagueRefresh({
  loading,
  updatedAt,
  error,
  refresh,
}: {
  loading: boolean;
  updatedAt: string | null;
  error: string | null;
  refresh: () => Promise<void>;
}) {
  const ui = useUiStyles();
  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
        <ActionButton
          label="Refresh"
          variant="secondary"
          loading={loading}
          onPress={() => void refresh()}
        />
        <Text style={ui.body}>
          {updatedAt ? `Updated ${adminDate(updatedAt)}` : 'Waiting for data'}
        </Text>
      </View>
      {error ? <ErrorState message={error} onRetry={() => void refresh()} /> : null}
    </View>
  );
}

export function LeagueFact({
  label,
  value,
}: {
  label: string;
  value: string | number | null | undefined;
}) {
  const ui = useUiStyles();
  return (
    <View style={{ gap: 3, flexBasis: 230, flexGrow: 1, minWidth: 0 }}>
      <Text style={ui.label}>{label}</Text>
      <Text selectable style={ui.body}>
        {value ?? 'Unavailable'}
      </Text>
    </View>
  );
}
