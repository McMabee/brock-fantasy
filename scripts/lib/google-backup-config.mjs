export function replaceGoogleBackupRemote(existing, section, reauthorize = false) {
  const headers = [...existing.matchAll(/^[ \t]*\[([^\]\r\n]+)\][ \t]*$/gmu)];
  const matches = headers.filter((header) => header[1] === 'brock-backups');
  if (matches.length > 1)
    throw new Error('The brock-backups configuration has duplicate sections; review it privately.');
  if (matches.length && !reauthorize)
    throw new Error(
      'The brock-backups remote already exists; review it before replacing authentication.',
    );
  if (!matches.length) return `${existing.trimEnd()}\n${section.trim()}\n`;
  const start = matches[0].index;
  const end = headers.find((header) => header.index > start)?.index ?? existing.length;
  return (
    [existing.slice(0, start).trimEnd(), section.trim(), existing.slice(end).trimStart()]
      .filter(Boolean)
      .join('\n\n')
      .trimEnd() + '\n'
  );
}
