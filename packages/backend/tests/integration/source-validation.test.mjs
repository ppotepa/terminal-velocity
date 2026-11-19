import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestPools, resetTestData } from './helpers/database.mjs';
import { fixture, context, origin, scope, NOW } from './helpers/provider-fixture.mjs';
import { createPermittedProviderPipeline } from '../../src/modules/source-connectors/composition/create-permitted-provider-pipeline.ts';
import { createProviderConnector } from '../../src/modules/source-connectors/composition/create-provider-connector.ts';
import { createFixtureCandidateDirectory } from '../../src/demo/infrastructure/fixture-candidate-directory.ts';
import { createFixtureFleet } from '../../src/demo/infrastructure/fixture-fleet.ts';

const pools = createTestPools();
const directory = createFixtureCandidateDirectory(createFixtureFleet());
const permission = { sourceId: scope.sourceId, provider: scope.provider,
  accountScope: scope.accountScope, sourceEpoch: scope.sourceEpoch,
  purpose: 'PRIVATE_PROCESSING', retentionAllowed: true,
  evidenceReference: 'repository-synthetic-fixtures-only' };
const pipeline = () => createPermittedProviderPipeline(pools.runtime, directory, permission, () => NOW);
beforeEach(() => resetTestData(pools.admin));
after(() => pools.close());

test('synthetic validation traces delivery, observation, revision, decision and private read across worker restart', async () => {
  const raw = fixture();
  const initial = pipeline();
  const received = await initial.accept(raw, context(raw), scope, origin);
  assert.equal(received.value.outcome, 'CREATED');

  const restarted = pipeline();
  await restarted.drain();
  const chain = (await pools.runtime.query(`SELECT d.delivery_id,d.source_id,d.provider_id,d.data_level,
      d.observed_at_ms,d.ingested_at_ms,m.message_id,m.revision AS message_revision,m.canonical,
      s.decision_revision,r.decision,c.aircraft_id,c.decision_revision AS contribution_revision
    FROM source_ingestion.deliveries d
    JOIN source_ingestion.message_sources s ON s.source_delivery_id=d.delivery_id
    JOIN source_ingestion.message_revisions m ON m.message_id=s.message_id AND m.revision=s.message_revision
    JOIN correlation.aircraft_link_revisions r ON r.message_id=s.message_id AND r.revision=s.decision_revision
    JOIN source_ingestion.private_contributions c ON c.message_id=s.message_id
    WHERE d.delivery_id=$1`, [received.value.deliveryId])).rows;
  assert.equal(chain.length, 1);
  assert.equal(chain[0].delivery_id, received.value.deliveryId);
  assert.equal(chain[0].source_id, scope.sourceId);
  assert.equal(chain[0].provider_id, scope.provider);
  assert.equal(chain[0].data_level, 'PROVIDER_MESSAGE');
  assert.equal(chain[0].canonical.provenance.originalSourceId, raw.originalSourceId);
  assert.equal(Number(chain[0].observed_at_ms), Date.parse(raw.sourceObservedAt.at));
  assert.equal(Number(chain[0].ingested_at_ms), NOW);
  assert.equal(Number(chain[0].message_revision), 1);
  assert.equal(Number(chain[0].decision_revision), 1);
  assert.equal(Number(chain[0].contribution_revision), 1);
  assert.equal(chain[0].decision.status, 'MATCHED');
  assert.equal(chain[0].aircraft_id, 'ac_demo-001');
  const status = await restarted.readPrivateStatus('ac_demo-001');
  assert.equal(status.freshness, 'RECENT');
  assert.equal(status.contributions[0].source_delivery_id, received.value.deliveryId);
  assert.equal(Number(status.contributions[0].observed_at_ms), Number(chain[0].observed_at_ms));

  const replay = await restarted.accept(raw, context(raw), scope, origin);
  assert.equal(replay.value.outcome, 'DUPLICATE');
  await restarted.drain();
  assert.equal((await pools.runtime.query('SELECT count(*) AS n FROM source_ingestion.message_revisions')).rows[0].n, '1');
  assert.equal((await pools.runtime.query('SELECT count(*) AS n FROM source_ingestion.private_contributions')).rows[0].n, '1');
});

test('decode failure, missing observation time, unresolved aircraft and disconnect cannot confirm private freshness', async () => {
  const p = pipeline();
  const invalid = fixture();
  invalid.aircraft.icao24 = 'invalid';
  assert.equal((await p.accept(invalid, context(invalid), scope, origin)).ok, false);
  const missingTime = fixture();
  delete missingTime.sourceObservedAt;
  assert.equal((await p.accept(missingTime, context(missingTime), scope, origin)).ok, true);
  const unknown = fixture();
  unknown.aircraft = { icao24: 'FFFFFF' };
  const unknownReceipt = await p.accept(unknown, context(unknown), scope, origin);
  assert.equal(unknownReceipt.value.outcome, 'CREATED');
  await p.drain();
  const decisions = (await pools.runtime.query('SELECT decision FROM correlation.aircraft_link_revisions')).rows;
  assert.deepEqual(decisions.map(row => row.decision.status), ['UNMATCHED']);
  assert.equal((await p.readPrivateStatus('ac_demo-001')).freshness, 'NONE');
  assert.equal((await pools.runtime.query('SELECT count(*) AS n FROM source_ingestion.import_quarantine')).rows[0].n, '1');
  const disconnected = createProviderConnector('crawl', 'D00001');
  assert.equal(await disconnected.start(() => { throw new Error('Must not deliver'); }), 'RIGHTS_BLOCKED');
  assert.equal(disconnected.health().state, 'DISCONNECTED');
  assert.equal(disconnected.health().accepted, 0);
  assert.equal((await p.readPrivateStatus('ac_demo-001')).freshness, 'NONE');
});
