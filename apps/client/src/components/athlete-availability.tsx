import { Text, View } from 'react-native';
import { useAthleteAvailability } from '@/providers/athlete-availability-provider';
import type { AvailabilityFilter, AvailabilityOrder } from '@/lib/athlete-availability';
import { useThemeColors, useTheme } from '@/providers/theme-provider';
import { useUiStyles } from './ui';
import { AdminSelect } from './admin-ui';

export function AthleteStatus({ athleteId }: { athleteId: string | null | undefined }) {
  const { rows, unavailable, error } = useAthleteAvailability(athleteId ? [athleteId] : []);
  const colors = useThemeColors();
  const { mode } = useTheme();
  if (!athleteId) return null;
  const row = rows.get(athleteId);
  if (!row)
    return (
      <Text style={{ color: colors.muted, fontSize: 12 }}>
        {error || unavailable.has(athleteId) ? 'Status unavailable' : 'Loading status…'}
      </Text>
    );
  const injured = row.availability_status === 'injured';
  const label = injured ? 'Injured' : 'Active';
  const foreground = injured ? colors.danger : mode === 'dark' ? '#86EFAC' : '#166534';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <View
        accessibilityLabel={`Player status: ${label}${error ? ', last confirmed status' : ''}`}
        style={{
          borderRadius: 999,
          borderWidth: 1,
          borderColor: foreground,
          backgroundColor: injured
            ? mode === 'dark'
              ? '#390C15'
              : '#FFF0F1'
            : mode === 'dark'
              ? '#102D20'
              : '#F0FDF4',
          paddingHorizontal: 9,
          paddingVertical: 3,
          alignSelf: 'flex-start',
        }}
      >
        <Text style={{ color: foreground, fontFamily: 'Inter', fontSize: 12, fontWeight: '700' }}>
          {label}
        </Text>
      </View>
      {error ? (
        <Text style={{ color: colors.muted, fontSize: 12 }}>Refresh unavailable</Text>
      ) : null}
    </View>
  );
}

export function AvailabilityControls({
  filter,
  order = 'default',
  onFilter,
  onOrder,
}: {
  filter: AvailabilityFilter;
  order?: AvailabilityOrder;
  onFilter: (value: AvailabilityFilter) => void;
  onOrder?: (value: AvailabilityOrder) => void;
}) {
  const ui = useUiStyles();
  const { error } = useAthleteAvailability();
  return (
    <View style={{ gap: 10, marginVertical: 12 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
        <View style={{ flex: 1, minWidth: 180 }}>
          <AdminSelect
            label="Player status"
            value={filter}
            options={[
              { value: 'all', label: 'All statuses' },
              { value: 'active', label: 'Active' },
              { value: 'injured', label: 'Injured' },
            ]}
            onChange={(value) => onFilter(value as AvailabilityFilter)}
          />
        </View>
        {onOrder ? (
          <View style={{ flex: 1, minWidth: 180 }}>
            <AdminSelect
              label="Status order"
              value={order}
              options={[
                { value: 'default', label: 'Default order' },
                { value: 'active', label: 'Active first' },
                { value: 'injured', label: 'Injured first' },
              ]}
              onChange={(value) => onOrder(value as AvailabilityOrder)}
            />
          </View>
        ) : null}
      </View>
      {error ? (
        <Text accessibilityRole="alert" style={ui.body}>
          Status updates are unavailable. Showing last confirmed values while reconnecting.
        </Text>
      ) : null}
    </View>
  );
}
