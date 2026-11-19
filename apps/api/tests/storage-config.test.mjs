import test from 'node:test';
import assert from 'node:assert/strict';
import { readStorageConfig } from '../src/runtime/storage-config.ts';

test('memory storage is explicit by default even when an unrelated database URL is present', () => {
  assert.deepEqual(readStorageConfig({ DATABASE_URL: 'postgresql://localhost/unused' }), { driver: 'memory' });
  const databaseUrl = 'postgresql://runtime:synthetic@localhost/terminal_velocity_dev';
  assert.deepEqual(readStorageConfig({ STORAGE_DRIVER: 'postgres', DATABASE_URL: databaseUrl }),
    { driver: 'postgres', databaseUrl });
});

test('PostgreSQL configuration rejects missing or invalid destinations without echoing credentials', () => {
  for (const DATABASE_URL of [undefined, '', ' ', 'not a URL', 'https://name:secret@host/db', 'postgresql://host/', ' postgresql://host/db']) {
    assert.throws(() => readStorageConfig({ STORAGE_DRIVER: 'postgres', DATABASE_URL }), error => {
      assert.doesNotMatch(error.message, /secret|name:|not a URL/);
      return true;
    });
  }
  assert.throws(() => readStorageConfig({ STORAGE_DRIVER: 'sqlite' }), /STORAGE_DRIVER/);
});
