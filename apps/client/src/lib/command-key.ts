export function newCommandKey(): string {
  // - Timestamped intents allow expired receipts to be deleted without replaying stale commands
  return `bf2:${Date.now()}:${crypto.randomUUID()}`;
}
