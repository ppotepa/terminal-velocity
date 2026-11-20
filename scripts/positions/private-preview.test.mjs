import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { startPrivatePositionPreview } from './private-preview.mjs';
import { readPreviewArguments } from './read-arguments.mjs';
import { createAdsbLolPositionTransportForTest } from '../../packages/backend/src/modules/source-connectors/infrastructure/positions/adsb-lol/transport.ts';
import { createPositionRequestBudget } from '../../packages/backend/src/modules/source-connectors/infrastructure/positions/adsb-lol/request-budget.ts';

const fixture = JSON.parse(await readFile(new URL('../../packages/backend/tests/fixtures/positions/adsb-lol-v2-synthetic.json', import.meta.url), 'utf8'));
const query = { latitude: 52.52, longitude: 13.405, radiusNm: 10 };

test('private preview starts on loopback, serves canonical observations only, and shuts down', async () => {
  const preview = await startPrivatePositionPreview({ query, transportFactory: (positionQuery, sourceId, capabilities) =>
    createAdsbLolPositionTransportForTest(positionQuery, sourceId, capabilities, {
      response: new Response(JSON.stringify(fixture), {
        headers: { 'content-type': 'application/json' },
      }),
      now: () => Date.parse('2026-11-19T12:00:02.000Z'),
      requestBudget: createPositionRequestBudget(),
    }),
  });
  try {
    assert.equal(preview.host, '127.0.0.1');
    assert.equal(preview.port > 0, true);
    const address = `http://127.0.0.1:${preview.port}/positions`;
    let body;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const response = await fetch(address);
      body = await response.json();
      if (response.status === 200) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(preview.health().status, 'CONNECTED');
    assert.equal(body.batch.observations.length, 3);
    assert.equal(body.batch.provider, 'adsb.lol');
    assert.equal(body.batch.ac, undefined);
    assert.equal(body.batch.future_provider_field, undefined);
    assert.equal((await fetch(`http://127.0.0.1:${preview.port}/`)).status, 404);
  } finally {
    await preview.close();
  }
  assert.equal(preview.health().status, 'STOPPED');
  assert.equal(preview.run instanceof Promise, true);
  await preview.close();
});

test('preview rejects invalid geographic input before starting transport', async () => {
  let called = false;
  await assert.rejects(startPrivatePositionPreview({
    query: { ...query, radiusNm: 51 },
    transportFactory: () => { called = true; throw new Error('unexpected'); },
  }), RangeError);
  assert.equal(called, false);
});

test('private preview never serves a provider failure as a position batch', async () => {
  const preview = await startPrivatePositionPreview({ query, transportFactory: () => ({
    fetchNext: async () => ({ ok: false, error: { code: 'AUTHENTICATION_FAILURE', status: 403 } }),
  }) });
  try {
    await preview.run;
    const response = await fetch(`http://127.0.0.1:${preview.port}/positions`);
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.error, 'NO_SNAPSHOT');
    assert.equal(body.batch, undefined);
    assert.equal(body.health.lastErrorCode, 'AUTHENTICATION_FAILURE');
  } finally {
    await preview.close();
  }
});

test('CLI requires explicit live opt-in before any provider request', () => {
  assert.throws(() => readPreviewArguments(['--lat', '52.52', '--lon', '13.405', '--radius-nm', '10']),
    /Explicit --live is required/u);
  assert.deepEqual(readPreviewArguments(['--live', '--lat', '52.52', '--lon', '13.405', '--radius-nm', '10']).query,
    query);
});
