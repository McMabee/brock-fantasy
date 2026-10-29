import { useEffect, useRef, type ReactNode } from 'react';
import { Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useResponsiveDimensions } from '@/hooks/use-responsive-dimensions';
import { useThemeColors } from '@/providers/theme-provider';
import { ActionButton, useUiStyles } from './ui';

export const adminMultiline = { paddingVertical: 12, textAlignVertical: 'top' as const };

export function AdminSelect({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const ui = useUiStyles();
  const colors = useThemeColors();
  if (Platform.OS === 'web')
    return (
      <label
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          minWidth: 0,
          color: colors.text,
          fontFamily: 'Inter',
          fontSize: 13,
          fontWeight: 700,
        }}
      >
        {label}
        <select
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          style={{
            width: '100%',
            minWidth: 0,
            minHeight: 50,
            padding: '12px 14px',
            borderRadius: 8,
            border: `1px solid ${colors.controlBorder}`,
            background: colors.canvasSoft,
            color: colors.text,
            fontFamily: 'Inter',
            fontSize: 16,
          }}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    );
  return (
    <View style={{ gap: 8 }}>
      <Text style={ui.label}>{label}</Text>
      {options.map((option) => (
        <ActionButton
          key={option.value}
          label={option.label}
          disabled={disabled}
          variant={value === option.value ? 'primary' : 'secondary'}
          onPress={() => onChange(option.value)}
        />
      ))}
    </View>
  );
}

export function AdminDateInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const colors = useThemeColors();
  const ui = useUiStyles();
  if (Platform.OS === 'web')
    return (
      <label
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          minWidth: 0,
          color: colors.text,
          fontFamily: 'Inter',
          fontSize: 13,
          fontWeight: 700,
        }}
      >
        {label}
        <input
          type="date"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          style={{
            boxSizing: 'border-box',
            width: '100%',
            minWidth: 0,
            minHeight: 50,
            padding: '12px 14px',
            border: `1px solid ${colors.controlBorder}`,
            borderRadius: 8,
            color: colors.text,
            background: colors.canvasSoft,
            fontFamily: 'Inter',
            fontSize: 16,
          }}
        />
      </label>
    );
  return (
    <View style={{ gap: 8 }}>
      <Text style={ui.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        placeholder="YYYY-MM-DD"
        maxLength={10}
        style={ui.input}
      />
    </View>
  );
}

export function AdminTable({
  label,
  columns,
  rows,
}: {
  label: string;
  columns: readonly { label: string; width?: number }[];
  rows: readonly { id: string; cells: readonly ReactNode[] }[];
}) {
  const colors = useThemeColors();
  const ui = useUiStyles();
  return (
    <ScrollView
      horizontal
      role="region"
      tabIndex={0}
      accessibilityLabel={label}
      style={{ width: '100%', maxWidth: '100%', minWidth: 0 }}
    >
      {Platform.OS === 'web' ? (
        <table
          aria-label={label}
          style={{
            width: '100%',
            minWidth: columns.reduce((sum, col) => sum + (col.width ?? 130), 0),
            borderCollapse: 'collapse',
            color: colors.text,
            fontFamily: 'Inter',
            fontSize: 15,
          }}
        >
          <thead>
            <tr>
              {columns.map((col) => (
                <th
                  key={col.label}
                  scope="col"
                  style={{
                    minWidth: col.width ?? 130,
                    padding: '12px 10px',
                    textAlign: 'left',
                    whiteSpace: 'nowrap',
                    fontSize: 13,
                    borderBottom: `1px solid ${colors.border}`,
                  }}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                {row.cells.map((cell, index) => (
                  <td
                    key={index}
                    style={{
                      padding: '14px 10px',
                      verticalAlign: 'top',
                      borderBottom: `1px solid ${colors.border}`,
                    }}
                  >
                    {typeof cell === 'string' || typeof cell === 'number' ? cell : (cell ?? '—')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <View>
          <View style={{ flexDirection: 'row' }}>
            {columns.map((col) => (
              <Text key={col.label} style={[ui.label, { width: col.width ?? 130, padding: 10 }]}>
                {col.label}
              </Text>
            ))}
          </View>
          {rows.map((row) => (
            <View key={row.id} style={{ flexDirection: 'row' }}>
              {row.cells.map((cell, index) => (
                <View key={index} style={{ width: columns[index]?.width ?? 130, padding: 10 }}>
                  {typeof cell === 'string' || typeof cell === 'number' ? (
                    <Text style={ui.body}>{cell}</Text>
                  ) : (
                    cell
                  )}
                </View>
              ))}
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

export function AdminPanel({
  title,
  open,
  onClose,
  children,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const colors = useThemeColors();
  const ui = useUiStyles();
  const { width } = useResponsiveDimensions();
  const root = useRef<View>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open || Platform.OS !== 'web') return;
    const previous = document.activeElement as HTMLElement | null;
    const frame = requestAnimationFrame(() =>
      (root.current as unknown as HTMLElement | null)
        ?.querySelector<HTMLElement>('button,[tabindex="0"]')
        ?.focus(),
    );
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close.current();
      }
      if (event.key !== 'Tab') return;
      const items = [
        ...((root.current as unknown as HTMLElement | null)?.querySelectorAll<HTMLElement>(
          'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex="0"]',
        ) ?? []),
      ].filter((item) => item.getClientRects().length > 0);
      const first = items[0],
        last = items.at(-1);
      if (!first || !last) {
        event.preventDefault();
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', keydown);
      previous?.focus();
    };
  }, [open]);
  return (
    <Modal
      visible={open}
      transparent
      animationType="none"
      accessibilityLabel={title}
      onRequestClose={onClose}
    >
      <View style={{ flex: 1, backgroundColor: '#0009', alignItems: 'flex-end' }}>
        <Pressable
          onPress={onClose}
          accessible={false}
          style={{ position: 'absolute', inset: 0 }}
        />
        <View
          ref={root}
          style={{
            width: width < 768 ? '100%' : Math.min(620, width),
            flex: 1,
            backgroundColor: colors.panel,
            padding: 20,
            gap: 18,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Text accessibilityRole="header" style={[ui.title, { flex: 1 }]}>
              {title}
            </Text>
            <ActionButton label="Close" variant="secondary" onPress={onClose} />
          </View>
          <ScrollView contentContainerStyle={{ gap: 16, paddingBottom: 32 }}>{children}</ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export function AdminToggle({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const colors = useThemeColors();
  const ui = useUiStyles();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      aria-checked={selected}
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={{
        minHeight: 44,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingVertical: 8,
      }}
    >
      <Text accessible={false} style={[ui.body, { color: colors.text }]}>
        {selected ? '☑' : '☐'}
      </Text>
      <Text style={ui.body}>{label}</Text>
    </Pressable>
  );
}
