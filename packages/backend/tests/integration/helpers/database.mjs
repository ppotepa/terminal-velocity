import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';

export function uniqueId(prefix) { return `${prefix}_${randomUUID()}`; }

export function createTestPools() {
  const expected = process.env.TV_TEST_DATABASE_NAME;
  if (!process.env.TEST_DATABASE_URL || !process.env.TEST_RUNTIME_DATABASE_URL
      || !/^tv_test_[a-f0-9]{16}$/.test(expected ?? ''))
    throw new Error('Run these tests through npm run test:integration with an isolated TEST_DATABASE_URL.');
  for (const value of [process.env.TEST_DATABASE_URL, process.env.TEST_RUNTIME_DATABASE_URL]) {
    const url = new URL(value);
    if (url.pathname !== `/${expected}` || url.search || url.hash)
      throw new Error('The integration connection does not match the database created by the test runner.');
  }
  const options = { max: 8, connectionTimeoutMillis: 3_000, idleTimeoutMillis: 1_000,
    statement_timeout: 10_000, lock_timeout: 5_000 };
  const admin = new Pool({ ...options, connectionString: process.env.TEST_DATABASE_URL });
  const runtime = new Pool({ ...options, connectionString: process.env.TEST_RUNTIME_DATABASE_URL });
  let closing = false;
  const unexpectedErrors = [];
  for (const pool of [admin, runtime]) pool.on('error', error => {
    if (!closing) unexpectedErrors.push(error);
  });
  return { admin, runtime, async close() {
    closing = true;
    await Promise.all([admin.end(), runtime.end()]);
    if (unexpectedErrors.length) throw new AggregateError(unexpectedErrors, 'Unexpected PostgreSQL pool errors.');
  } };
}

/** Deliberate fixture cleanup in the randomly named database owned by the test runner. */
export async function resetTestData(admin) {
  const result = await admin.query('SELECT current_database() AS name');
  const expected = process.env.TV_TEST_DATABASE_NAME;
  if (!/^tv_test_[a-f0-9]{16}$/.test(expected ?? '') || result.rows[0]?.name !== expected)
    throw new Error('Refusing fixture cleanup outside the exact database created by the test runner.');
  await admin.query(`TRUNCATE
    tracking.current_position_inbox, tracking.current_position_jobs,
    tracking.current_position_heads, tracking.current_position_candidates,
    fleet_identity.replay_expansions,
    fleet_identity.position_link_jobs,
    fleet_identity.position_link_heads, fleet_identity.position_link_revisions,
    fleet_identity.replay_requests, fleet_identity.assertions, fleet_identity.aircraft,
    tracking.position_observation_outbox, tracking.position_observations,
    event_delivery.consumer_inbox, event_delivery.deliveries, event_delivery.events,
    source_ingestion.private_contributions, source_ingestion.message_sources, source_ingestion.message_revisions,
    source_ingestion.import_quarantine, source_ingestion.retained_inputs,
    source_ingestion.outbox, source_ingestion.provider_message_observations, source_ingestion.receptions, source_ingestion.deliveries,
    availability.contributions, correlation.outbox, correlation.aircraft_link_heads,
    correlation.aircraft_link_revisions, message_ingestion.messages`);
  await admin.query('UPDATE fleet_identity.registry_state SET revision=0 WHERE singleton');
  await admin.query("UPDATE fleet_identity.replay_scheduler SET next_kind='JOBS' WHERE singleton");
  await admin.query(`UPDATE tracking.current_position_backfill_progress
    SET last_source_id=NULL,last_source_observation_id=NULL,completed_at=NULL WHERE singleton`);
  await admin.query(`UPDATE fleet_identity.position_backfill_progress
    SET last_source_id=NULL,last_source_observation_id=NULL,completed_at=NULL WHERE singleton`);
}
