export interface ContactPayload {
  kind: 'contact' | 'bug' | 'suggestion';
  name: string;
  replyEmail: string;
  title: string;
  message: string;
  page: string;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
export function validContactReference(value: unknown): value is string {
  return typeof value === 'string' && uuid.test(value);
}
export interface ContactInput {
  requestId: string;
  payload: ContactPayload;
}
export function contactPayload(raw: unknown): ContactInput | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (
    !validContactReference(value.requestId) ||
    Object.keys(value).some(
      (key) =>
        !['requestId', 'kind', 'name', 'replyEmail', 'title', 'message', 'page'].includes(key),
    )
  )
    return null;
  const read = (key: string, maximum: number) =>
    value[key] === undefined
      ? ''
      : typeof value[key] === 'string' && value[key].length <= maximum
        ? value[key].trim()
        : null;
  const kind = read('kind', 12);
  const name = read('name', 100);
  const replyEmail = read('replyEmail', 320);
  const title = read('title', 150);
  const message = read('message', 5000);
  const page = read('page', 2000);
  if (
    !['contact', 'bug', 'suggestion'].includes(kind ?? '') ||
    name === null ||
    replyEmail === null ||
    title === null ||
    !message ||
    page === null ||
    (replyEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(replyEmail)) ||
    (kind === 'contact' && !replyEmail)
  )
    return null;
  let location = '';
  if (page) {
    try {
      const url = new URL(page);
      if (
        url.protocol !== 'https:' ||
        ![
          'play.brockfantasy.ca',
          'beta.brockfantasy.ca',
          'www.brockfantasy.ca',
          'brockfantasy.ca',
        ].includes(url.hostname) ||
        url.username ||
        url.password
      )
        return null;
      location = url.origin + url.pathname;
    } catch {
      return null;
    }
  }
  return {
    requestId: value.requestId,
    payload: {
      kind: kind as ContactPayload['kind'],
      name,
      replyEmail,
      title,
      message,
      page: location,
    },
  };
}

export async function boundedContactBody(request: Request): Promise<unknown> {
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      length += result.value.byteLength;
      if (length > 8192) {
        await reader.cancel();
        return null;
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let position = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, position);
    position += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}
