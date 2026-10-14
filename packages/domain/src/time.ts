const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Toronto',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
export function torontoDateFields(iso: string): { date: string; time: string } {
  const p = Object.fromEntries(
    formatter.formatToParts(new Date(iso)).map((part) => [part.type, part.value]),
  );
  return { date: p.year + '-' + p.month + '-' + p.day, time: p.hour + ':' + p.minute };
}
export function torontoDateTime(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date) || !/^\d{2}:\d{2}$/u.test(time)) return null;
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  if (hour! > 23 || minute! > 59) return null;
  const target = Date.UTC(year!, month! - 1, day, hour, minute);
  let candidate = target;
  for (let i = 0; i < 4; i++) {
    const actual = torontoDateFields(new Date(candidate).toISOString());
    const [y, m, d] = actual.date.split('-').map(Number);
    const [h, min] = actual.time.split(':').map(Number);
    const difference = target - Date.UTC(y!, m! - 1, d, h, min);
    if (difference === 0)
      return actual.date === date && actual.time === time
        ? new Date(candidate).toISOString()
        : null;
    candidate += difference;
  }
  return null;
}
