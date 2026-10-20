import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export function ViewportPortal({
  children,
  container,
}: {
  children: ReactNode;
  container?: Element | null;
}) {
  const [mounted, setMounted] = useState(false);
  // - Match the server render before mounting viewport overlays outside scrolling content
  useEffect(() => setMounted(true), []);
  return mounted ? createPortal(children, container ?? document.body) : null;
}
