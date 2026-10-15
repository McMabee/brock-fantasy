import { useLocalSearchParams } from 'expo-router';
import { PublicAuthEntry } from '@/components/public-auth-entry';

export default function SignupScreen() {
  const { next } = useLocalSearchParams<{ next?: string }>();
  return <PublicAuthEntry mode="sign-up" next={next} />;
}
