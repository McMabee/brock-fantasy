import { useLocalSearchParams } from 'expo-router';
import { AppShell } from '@/components/ui';
import { CommissionerControls } from '@/components/commissioner-controls';
import { useLeague } from '@/hooks/use-league';
import { useRequireUser } from '@/hooks/use-route-access';

export default function CommissionerScreen() {
  useRequireUser();
  const { leagueId } = useLocalSearchParams<{ leagueId: string }>();
  const leagueData = useLeague(leagueId);
  return (
    <AppShell title="Commissioner controls">
      <CommissionerControls leagueId={leagueId} leagueData={leagueData} />
    </AppShell>
  );
}
