import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { notificationTarget } from '../../apps/client/src/lib/notification-target.ts';
test('notification links remain actionable and reject injected locations', () => {
  const id = '00000000-0000-4000-8000-000000000001';
  assert.equal(notificationTarget('trade_accepted', { league_id: id }), '/transactions/' + id);
  assert.equal(notificationTarget('draft_reminder', { league_id: id }), '/league/' + id);
  assert.equal(notificationTarget('game_reminder', { league_id: id }), '/lineup-multisport/' + id);
  assert.equal(notificationTarget('draft_turn', { draft_id: id }), '/draft/' + id);
  assert.equal(
    notificationTarget('trade_accepted', { league_id: 'https://evil.example' }),
    '/dashboard',
  );
});
test('cookie renewal coalesces requests, preserves transient failures and clears confirmed expiry', async () => {
  const source = ts.transpileModule(await readFile('apps/client/src/lib/web-session.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const session = await import(
    'data:text/javascript;base64,' + Buffer.from(source).toString('base64')
  );
  const savedFetch = globalThis.fetch,
    savedDocument = globalThis.document,
    savedNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  try {
    globalThis.document = { cookie: 'bf_csrf=fixture' };
    Object.defineProperty(globalThis, 'navigator', {
      value: { locks: { request: async (_key, fn) => fn() } },
      configurable: true,
    });
    let count = 0,
      finish;
    const delayed = new Promise((resolve) => {
      finish = resolve;
    });
    const user = { id: 'fixture', email: null, emailConfirmedAt: '2026-10-13' };
    globalThis.fetch = async (url) =>
      url.endsWith('/session')
        ? Response.json({ user, expiresAt: Date.now() + 30_000 })
        : (count++, delayed);
    session.recordSessionExpiry(Date.now() + 30_000);
    const one = session.refreshWebSession(),
      two = session.refreshWebSession();
    assert.equal(one, two);
    finish(Response.json({ user, expiresAt: Date.now() + 3600_000 }));
    assert.equal((await one).status, 200);
    assert.equal(count, 1);
    assert.equal(session.sessionNeedsRenewal(), false);
    session.recordSessionExpiry(Date.now() + 30_000);
    globalThis.fetch = async () => new Response(null, { status: 503 });
    assert.equal((await session.refreshWebSession()).status, 503);
    assert.equal(session.sessionNeedsRenewal(), true);
    globalThis.fetch = async () => Response.json({ error: 'expired' }, { status: 401 });
    assert.equal((await session.refreshWebSession()).status, 401);
    assert.equal(session.sessionNeedsRenewal(), false);
  } finally {
    globalThis.fetch = savedFetch;
    if (savedDocument === undefined) delete globalThis.document;
    else globalThis.document = savedDocument;
    if (savedNavigator) Object.defineProperty(globalThis, 'navigator', savedNavigator);
    else delete globalThis.navigator;
  }
});
