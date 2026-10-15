import assert from 'node:assert/strict';
import test from 'node:test';
import { openPublicAuthEntry } from '../../apps/client/src/lib/public-auth-navigation.ts';

test('account entry loads the server document and rejects unrelated or external destinations', () => {
  const previous = globalThis.window;
  const destinations = [];
  try {
    globalThis.window = { location: { assign: (href) => destinations.push(href) } };
    for (const href of [
      '/auth',
      '/auth?mode=sign-up',
      '/signup',
      '/forgot-password',
      '/reset-password',
    ])
      assert.equal(openPublicAuthEntry(href), true);
    assert.equal(destinations.length, 5);
    for (const href of [
      '/dashboard',
      '/authenticate',
      '//example.test/auth',
      'https://example.test/signup',
      { pathname: '/auth' },
    ])
      assert.equal(openPublicAuthEntry(href), false);
    assert.equal(destinations.length, 5);
    globalThis.window = {};
    assert.equal(openPublicAuthEntry('/auth'), false);
    delete globalThis.window;
    assert.equal(openPublicAuthEntry('/auth'), false);
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
});
