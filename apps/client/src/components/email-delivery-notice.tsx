import { StyleSheet, Text, View } from 'react-native';
import {
  EMAIL_DELIVERY_ACTION,
  EMAIL_DELIVERY_EXPLANATION,
  EMAIL_DELIVERY_TITLE,
} from '@/lib/email-delivery';

export function EmailDeliveryNotice({ recipient = false }: { recipient?: boolean }) {
  return (
    <View accessibilityRole="alert" style={styles.notice}>
      <Text accessibilityRole="header" style={styles.title}>
        {recipient ? 'Important: Ask the recipient to check spam and junk' : EMAIL_DELIVERY_TITLE}
      </Text>
      <Text style={styles.body}>
        {EMAIL_DELIVERY_EXPLANATION}{' '}
        {recipient
          ? 'Ask them to check both folders as well as their inbox, and mark our email as "Not spam" or "Not junk" if they find it there.'
          : EMAIL_DELIVERY_ACTION}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  notice: {
    width: '100%',
    padding: 18,
    gap: 10,
    backgroundColor: '#FFF4D6',
    borderColor: '#B77900',
    borderWidth: 2,
    borderLeftWidth: 6,
    borderRadius: 12,
  },
  title: { fontFamily: 'Inter', fontWeight: '700', fontSize: 16, lineHeight: 23, color: '#593800' },
  body: { fontFamily: 'Inter', fontSize: 14, lineHeight: 22, color: '#593800' },
});
