import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startActivePoll } from '../../apps/client/src/lib/active-poll.ts';
import { createSingleFlight } from '../../apps/client/src/lib/single-flight.ts';

test('stopping a poll during a request prevents all subsequent scheduled reads', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let finish,
    calls = 0;
  const gate = new Promise((resolve) => {
    finish = resolve;
  });
  const stop = startActivePoll(async () => {
    calls++;
    await gate;
  }, 2000);
  assert.equal(calls, 1);
  stop();
  finish();
  await gate;
  await Promise.resolve();
  context.mock.timers.tick(20000);
  assert.equal(calls, 1);
});

test('terminal snapshots stop polling and reactivation starts immediately', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  let closed = false;
  const request = async () => {
    calls++;
    closed = true;
  };
  startActivePoll(request, 2000, () => !closed);
  await Promise.resolve();
  context.mock.timers.tick(20000);
  assert.equal(calls, 1);
  startActivePoll(request, 2000, () => !closed);
  assert.equal(calls, 1);
  const stop = startActivePoll(request, 2000);
  assert.equal(calls, 2);
  await Promise.resolve();
  context.mock.timers.tick(2000);
  assert.equal(calls, 3);
  stop();
});

test('single flight separates sessions and keys and never retains completed responses', async () => {
  const read = createSingleFlight();
  const scope = {};
  let finish,
    calls = 0;
  const gate = new Promise((resolve) => {
    finish = resolve;
  });
  const request = async () => {
    calls++;
    await gate;
    return calls;
  };
  const first = read(scope, 'pool', request);
  assert.equal(read(scope, 'pool', request), first);
  const otherKey = read(scope, 'athlete', request);
  const otherSession = read({}, 'pool', request);
  await Promise.resolve();
  assert.equal(calls, 3);
  finish();
  await Promise.all([first, otherKey, otherSession]);
  assert.notEqual(read(scope, 'pool', request), first);
});

test('failed reads leave no rejected entry in a session scope', async () => {
  const read = createSingleFlight();
  const scope = {};
  await assert.rejects(
    read(scope, 'pool', async () => {
      throw new Error('offline');
    }),
    /offline/u,
  );
  assert.equal(await read(scope, 'pool', async () => 'reconnected'), 'reconnected');
});
