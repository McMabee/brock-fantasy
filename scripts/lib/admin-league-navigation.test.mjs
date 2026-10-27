import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  adminLeaguePath,
  adminReturnPath,
  authReturnPath,
} from '../../apps/client/src/lib/admin-navigation.ts';

test('league explorer survives authentication and MFA with its directory context', () => {
  const path = adminLeaguePath('/admin/leagues/11111111-1111-4111-8111-111111111111', {
    season: 'previous',
    status: 'archived',
    q: 'Member & Team',
    beforeAt: '2026-10-27T12:00:00Z',
    beforeId: '22222222-2222-4222-8222-222222222222',
    page: '2',
    tab: 'members',
  });
  assert.equal(adminReturnPath(path), path);
  assert.equal(authReturnPath(path), path);
  assert.match(path, /q=Member\+%26\+Team/u);
  assert.equal(adminReturnPath('/admin/leagues?season=all'), '/admin/leagues?season=all');
});

test('league return paths cannot redirect outside the explorer', () => {
  for (const path of [
    'https://evil.test/admin/leagues',
    '//evil.test/admin/leagues',
    '/admin/leagues/../accounts?next=https://evil.test',
    '/admin/leagues/invalid',
    '/admin/leagues#secret',
  ]) {
    assert.equal(authReturnPath(path), '/dashboard');
  }
  assert.equal(adminReturnPath('/admin/leagues?redirect=https://evil.test'), '/admin/leagues');
});
