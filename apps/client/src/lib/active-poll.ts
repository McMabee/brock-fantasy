export function startActivePoll(
  run: () => Promise<unknown>,
  delay: number | (() => number),
  shouldContinue: () => boolean = () => true,
): () => void {
  let active = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const poll = async () => {
    if (!active || !shouldContinue()) return;
    try {
      await run();
    } catch {
      // - Request owners present errors while the scheduler preserves the retry cadence
    } finally {
      if (active && shouldContinue())
        timer = setTimeout(() => void poll(), typeof delay === 'number' ? delay : delay());
    }
  };
  void poll();
  return () => {
    active = false;
    clearTimeout(timer);
  };
}
