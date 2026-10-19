import { Link } from 'expo-router';
import { Text, View } from 'react-native';
import { InfoButton } from './info-button';
import { useUiStyles } from './ui';

export function RulesLink({
  section,
  label = 'How to play',
}: {
  section?: string;
  label?: string;
}) {
  const styles = useUiStyles();
  const topic =
    section === 'stats'
      ? label.toLowerCase().includes('adp')
        ? 'adp'
        : 'projection'
      : section === 'transactions'
        ? 'waivers'
        : section === 'rosters' || section === 'roster'
          ? 'positions'
          : section === 'lineups' || section === 'lineup' || section === 'schedule'
            ? 'locks'
            : section === 'scoring'
              ? 'points'
              : null;
  if (topic)
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
        <Text style={styles.body}>{label}</Text>
        <InfoButton topic={topic} />
      </View>
    );
  return (
    <Link
      href={section ? { pathname: '/rules', params: { section } } : '/rules'}
      style={[styles.body, styles.link, { paddingVertical: 12, minHeight: 44 }]}
    >
      {label}
    </Link>
  );
}
