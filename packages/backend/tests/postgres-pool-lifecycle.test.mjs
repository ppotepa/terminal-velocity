import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { trackPoolShutdown } from '../../../scripts/postgres/drain-pool.mjs';

test('database cleanup waits for every client disconnect after the pool ends', async () => {
  const pool = new EventEmitter();
  let ended = false;
  pool.end = async () => { ended = true; };
  const close = trackPoolShutdown(pool);
  const first = new EventEmitter(), second = new EventEmitter();
  pool.emit('connect', first);
  pool.emit('connect', second);
  first.emit('end'); // An earlier idle disconnect must also be handled.
  let closed = false;
  const closing = close().then(() => { closed = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ended, true);
  assert.equal(closed, false);
  second.emit('end');
  await closing;
  assert.equal(closed, true);
});

test('pool shutdown handles no connections and propagates shutdown failure', async () => {
  const pool = new EventEmitter();
  pool.end = async () => {};
  await trackPoolShutdown(pool)();
  const failure = new Error('synthetic shutdown failure');
  pool.end = async () => { throw failure; };
  await assert.rejects(trackPoolShutdown(pool)(), error => error === failure);
});
