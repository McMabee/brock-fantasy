import { Redirect, useLocalSearchParams } from 'expo-router';

export default function LegacyLineupScreen() {
  const { leagueId } = useLocalSearchParams<{ leagueId?: string }>();
  return (
    <Redirect
      href={
        leagueId
          ? { pathname: '/lineup-multisport/[leagueId]', params: { leagueId } }
          : '/dashboard'
      }
    />
  );
}
