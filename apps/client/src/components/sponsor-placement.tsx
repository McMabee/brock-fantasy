import { useEffect, useRef, useState } from 'react';
import { Image, Linking, Pressable, StyleSheet, Text } from 'react-native';

import { Card } from '@/components/ui';
import { firstRelated } from '@/lib/relations';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/providers/session-provider';
import { useThemedStyles, type ThemeColors } from '@/theme';

interface Campaign {
  id: string;
  creativeUrl: string;
  sponsorName: string;
  destinationUrl: string;
}

interface CampaignRow {
  id: string;
  creative_url: string;
  sponsor:
    | { name: string; destination_url: string }
    | readonly { name: string; destination_url: string }[];
}

export function SponsorPlacement({
  placement,
  competitionId,
}: {
  placement: string;
  competitionId?: string | undefined;
}) {
  const { demoMode } = useSession();
  const styles = useStyles();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const impressionRecorded = useRef<string | null>(null);

  useEffect(() => {
    if (demoMode || !supabase) return;
    const client = supabase;
    const load = async () => {
      let query = client
        .from('sponsor_campaigns')
        .select('id, creative_url, sponsor:sponsors!inner(name, destination_url)')
        .eq('placement', placement)
        .eq('status', 'active')
        .lte('starts_at', new Date().toISOString())
        .gte('ends_at', new Date().toISOString());
      query = competitionId
        ? query.or(`competition_id.is.null,competition_id.eq.${competitionId}`)
        : query.is('competition_id', null);
      const result = await query.order('starts_at', { ascending: false }).limit(1).maybeSingle();
      if (result.error || !result.data) return;
      const row = result.data as unknown as CampaignRow;
      const sponsor = firstRelated(row.sponsor);
      if (!sponsor) return;
      setCampaign({
        id: row.id,
        creativeUrl: row.creative_url,
        sponsorName: sponsor.name,
        destinationUrl: sponsor.destination_url,
      });
    };
    void load();
  }, [competitionId, demoMode, placement]);

  useEffect(() => {
    if (!campaign || !supabase || impressionRecorded.current === campaign.id) return;
    impressionRecorded.current = campaign.id;
    void supabase.rpc('record_sponsor_event', {
      p_campaign_id: campaign.id,
      p_event_type: 'impression',
    });
  }, [campaign]);

  if (demoMode) {
    return (
      <Card style={styles.card}>
        <Text style={styles.label}>PRESENTED BY</Text>
        <Text style={styles.name}>Approved sponsor placement</Text>
        <Text style={styles.demo}>Demo only · no metric recorded</Text>
      </Card>
    );
  }
  if (!campaign) return null;

  const openCampaign = async () => {
    if (!campaign.destinationUrl.startsWith('https://')) return;
    if (supabase)
      await supabase.rpc('record_sponsor_event', {
        p_campaign_id: campaign.id,
        p_event_type: 'click',
      });
    await Linking.openURL(campaign.destinationUrl);
  };

  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`Visit ${campaign.sponsorName}`}
      onPress={() => void openCampaign()}
    >
      <Card style={styles.card}>
        <Text style={styles.label}>PRESENTED BY</Text>
        <Image
          accessibilityIgnoresInvertColors
          resizeMode="contain"
          source={{ uri: campaign.creativeUrl }}
          style={styles.creative}
        />
        <Text style={styles.name}>{campaign.sponsorName}</Text>
      </Card>
    </Pressable>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    card: { alignItems: 'center', borderStyle: 'dashed' },
    label: { color: colors.muted, fontSize: 8, letterSpacing: 2 },
    creative: { width: '100%', height: 72, marginTop: 8 },
    name: { color: colors.text, fontSize: 16, fontWeight: '700', marginTop: 8 },
    demo: { color: colors.muted, fontSize: 9, marginTop: 5 },
  });

const useStyles = () => useThemedStyles(createStyles);
