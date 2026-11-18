import test from 'node:test';
import assert from 'node:assert/strict';
import { readApiConfig } from '../src/runtime/config.ts';

test('API defaults to port 3000 and always binds the executable to loopback', () => {
  assert.deepEqual(readApiConfig({}), { host: '127.0.0.1', port: 3000 });
  assert.deepEqual(readApiConfig({ PORT: '4200', HOST: '0.0.0.0' }), { host: '127.0.0.1', port: 4200 });
  assert.deepEqual(readApiConfig({ PORT: '65535' }), { host: '127.0.0.1', port: 65535 });
});

test('PORT parsing rejects coercion, whitespace, zero, fractions and invalid bounds', () => {
  for (const PORT of ['', '0', '03000', '-1', '+3000', '3000 ', ' 3000', '3.5', '3e3', '3000x', '65536', '999999', 'NaN']) {
    assert.throws(() => readApiConfig({ PORT }), /PORT must be a decimal integer/);
  }
});
