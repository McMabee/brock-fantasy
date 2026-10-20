import type { ReactNode } from 'react';

export function ViewportPortal({ children }: { children: ReactNode; container?: Element | null }) {
  return children;
}
