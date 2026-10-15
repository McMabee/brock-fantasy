import { Link } from 'expo-router';
import { useUiStyles } from './ui';

export function RulesLink({
  section,
  label = 'How to play',
}: {
  section?: string;
  label?: string;
}) {
  const styles = useUiStyles();
  return (
    <Link
      href={section ? { pathname: '/rules', params: { section } } : '/rules'}
      style={[styles.body, styles.link, { paddingVertical: 12, minHeight: 44 }]}
    >
      {label}
    </Link>
  );
}
