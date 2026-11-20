import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import {
  createAvailabilityStore,
  matchesAvailability,
  compareAvailability,
} from '../../apps/client/src/lib/athlete-availability.ts';
import { notificationTarget } from '../../apps/client/src/lib/notification-target.ts';
const settle = () => new Promise((resolve) => setImmediate(resolve));
const row = (id, status = 'active') => ({
  id,
  availability_status: status,
  availability_revision: 1,
  availability_changed_at: null,
});

test('mounted consumers batch and deduplicate overlapping athlete requests and stop while hidden', async () => {
  const calls = [];
  const store = createAvailabilityStore(async (ids) => {
    calls.push(ids);
    return ids.map((id) => row(id));
  });
  store.setActive(true);
  const off1 = store.watch(['a', 'b']);
  const off2 = store.watch(['b', 'c']);
  await settle();
  assert.deepEqual(calls, [['a', 'b', 'c']]);
  const unchanged = store.getSnapshot();
  await store.refresh();
  assert.equal(
    store.getSnapshot(),
    unchanged,
    'unchanged polls do not rerender or resort every player',
  );
  off1();
  await store.refresh();
  assert.deepEqual(calls.at(-1), ['b', 'c']);
  store.setActive(false);
  const before = calls.length;
  await store.refresh();
  assert.equal(calls.length, before);
  store.setActive(true);
  await settle();
  assert.equal(calls.length, before + 1);
  off2();
  await store.refresh();
  assert.equal(calls.length, before + 1);
  store.dispose();
});
test('unknown and denied statuses never become Active and recovery refreshes a cached injury', async () => {
  let state = 'empty';
  const store = createAvailabilityStore(async () => {
    if (state === 'fail') throw new Error('network');
    if (state === 'denied') throw Object.assign(new Error('denied'), { denied: true });
    return state === 'empty' ? [] : [row('a', state)];
  });
  store.setActive(true);
  store.watch(['a']);
  await settle();
  assert.equal(store.getSnapshot().rows.has('a'), false);
  assert.equal(store.getSnapshot().unavailable.has('a'), true);
  state = 'injured';
  await store.refresh();
  state = 'fail';
  await store.refresh();
  assert.equal(store.getSnapshot().rows.get('a').availability_status, 'injured');
  assert.equal(store.getSnapshot().error, true);
  state = 'active';
  await store.refresh();
  assert.equal(store.getSnapshot().error, false);
  assert.equal(store.getSnapshot().rows.get('a').availability_status, 'active');
  state = 'denied';
  await store.refresh();
  assert.equal(store.getSnapshot().rows.size, 0);
  store.dispose();
});
test('disposed session responses cannot repopulate state and in-flight reads remain single-flight', async () => {
  let release,
    calls = 0;
  const store = createAvailabilityStore(() => {
    calls++;
    return new Promise((resolve) => {
      release = resolve;
    });
  });
  store.setActive(true);
  store.watch(['a']);
  await settle();
  const pending = store.refresh();
  assert.equal(calls, 1);
  store.dispose();
  release([row('a')]);
  await pending;
  assert.equal(store.getSnapshot().rows.size, 0);
});
test('status filtering and grouping preserve existing order within groups and put unknown values last', () => {
  const rows = new Map([
    ['a', row('a')],
    ['b', row('b', 'injured')],
    ['c', row('c')],
  ]);
  const ids = ['c', 'b', 'a', 'unknown'];
  assert.deepEqual(
    ids.filter((id) => matchesAvailability(id, rows, 'injured')),
    ['b'],
  );
  assert.deepEqual(
    [...ids].sort((a, b) => compareAvailability(a, b, rows, 'injured')),
    ['b', 'c', 'a', 'unknown'],
  );
  assert.deepEqual(
    [...ids].sort((a, b) => compareAvailability(a, b, rows, 'default')),
    ids,
  );
});
test('owner alerts resolve to the correct league lineup and reject malformed links', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  assert.equal(
    notificationTarget('athlete_injured', { league_id: id, pool_id: id }),
    `/lineup-multisport/${id}`,
  );
  assert.equal(
    notificationTarget('athlete_active', { league_id: id, pool_id: null }),
    `/lineup/${id}`,
  );
  assert.equal(
    notificationTarget('athlete_injured', { league_id: 'https://evil.test' }),
    '/dashboard',
  );
});

test('push dispatcher leaves injury and recovery in the inbox while other notification kinds remain dispatchable', async () => {
  const source = (
    await readFile('supabase/functions/dispatch-push-notifications/index.ts', 'utf8')
  ).replace(/^import .*;\r?\n/gmu, '');
  for (const includeTrade of [false, true]) {
    let handler,
      writes = 0;
    const inbox = [
      { id: 'injury', user_id: 'manager', kind: 'athlete_injured' },
      { id: 'recovery', user_id: 'manager', kind: 'athlete_active' },
      ...(includeTrade ? [{ id: 'trade', user_id: 'manager', kind: 'trade_proposed' }] : []),
    ];
    const db = {
      from(table) {
        let data =
          table === 'notifications'
            ? [...inbox]
            : table === 'push_tokens'
              ? [{ id: 'token', user_id: 'manager', expo_push_token: 'fixture-token' }]
              : [];
        const query = {
          select() {
            return query;
          },
          eq() {
            return query;
          },
          gte() {
            return query;
          },
          lte() {
            return query;
          },
          order() {
            return query;
          },
          limit() {
            return query;
          },
          in() {
            return query;
          },
          not(column, operator, value) {
            if (column === 'kind' && operator === 'in')
              data = data.filter((row) => !value.slice(1, -1).split(',').includes(row.kind));
            return query;
          },
          upsert() {
            writes++;
            throw new Error('dispatch attempted');
          },
          then(resolve, reject) {
            return Promise.resolve({ data, error: null }).then(resolve, reject);
          },
        };
        return query;
      },
    };
    runInNewContext(stripTypeScriptTypes(source), {
      Deno: {
        serve(callback) {
          handler = callback;
        },
        env: {
          get() {
            return null;
          },
        },
      },
      serviceClient: () => db,
      authenticatedAdmin: async () => ({}),
      corsHeaders: () => ({}),
      AccessError: class extends Error {},
      Response,
      Request,
      fetch: () => {
        throw new Error('unexpected external delivery');
      },
    });
    const response = await handler(
      new Request('http://local/dispatch', {
        method: 'POST',
        headers: { authorization: 'Bearer fixture' },
      }),
    );
    assert.equal(writes, includeTrade ? 1 : 0);
    assert.equal(response.status, includeTrade ? 400 : 200);
    if (!includeTrade) assert.deepEqual(await response.json(), { ticketed: 0, receipts: 0 });
    assert.equal(inbox.length, includeTrade ? 3 : 2);
  }
});
