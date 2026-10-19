import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export function ViewportPortal({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  // - Match the server render before mounting viewport overlays outside scrolling content
  useEffect(() => setMounted(true), []);
  return mounted ? createPortal(children, document.body) : null;
}
