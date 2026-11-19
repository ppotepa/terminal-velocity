import { createTestPools } from './database.mjs';
import { createSyntheticProviderPipeline } from '../../../src/modules/source-connectors/composition/create-synthetic-provider-pipeline.ts';
import { createFixtureCandidateDirectory } from '../../../src/demo/infrastructure/fixture-candidate-directory.ts';
import { createFixtureFleet } from '../../../src/demo/infrastructure/fixture-fleet.ts';
import { SOURCE_IMPORT_CONSUMER } from '../../../src/modules/source-connectors/infrastructure/postgres/source-event-router.ts';
import { NOW } from './provider-fixture.mjs';
const pools = createTestPools();
const pipeline = createSyntheticProviderPipeline(pools.runtime, createFixtureCandidateDirectory(createFixtureFleet()), () => NOW);
process.once('message', async ({ phase }) => {
  try {
    await pipeline.route();
    const lease = await pipeline.queue.leaseNext(SOURCE_IMPORT_CONSUMER, 30_000);
    if (phase === 'LEASED') process.kill(process.pid, 'SIGKILL');
    await pipeline.consumeSource(lease);
    // SQL ACK is atomic with import. Kill before the caller receives the successful result.
    process.kill(process.pid, 'SIGKILL');
  } catch { await pools.close(); process.exitCode = 1; process.disconnect(); }
});
process.send('READY');
