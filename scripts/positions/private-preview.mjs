import { createServer } from 'node:http';
import { positionSourceId } from '../../packages/backend/src/modules/flight-tracking/public/index.ts';
import { adsbLolPositionQuery } from '../../packages/backend/src/modules/source-connectors/infrastructure/positions/adsb-lol/query.ts';
import { createAdsbLolPositionTransport } from '../../packages/backend/src/modules/source-connectors/infrastructure/positions/adsb-lol/transport.ts';
import { createAdsbLolPositionPoller } from '../../packages/backend/src/modules/source-connectors/infrastructure/positions/adsb-lol/poller.ts';

const HOST = '127.0.0.1';
const SOURCE_ID = positionSourceId('src_adsblol-private-preview').value;
const CAPABILITIES = Object.freeze({
  sourceId: SOURCE_ID,
  measurementKinds: Object.freeze(['ADS_B', 'MLAT', 'OTHER']),
  observedAtBases: Object.freeze(['SOURCE_AGE_FROM_REFERENCE']),
});

export async function startPrivatePositionPreview({ query, port = 0, transportFactory = createAdsbLolPositionTransport }) {
  const validated = adsbLolPositionQuery(query);
  if (!validated.ok) throw new RangeError(`Invalid preview query: ${validated.error.field}.`);
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new RangeError('Invalid preview port.');
  const transport = transportFactory(validated.value, SOURCE_ID, CAPABILITIES);
  const poller = createAdsbLolPositionPoller(transport);
  let latest = null;
  const server = createServer((request, response) => {
    const pathname = request.url?.split('?', 1)[0];
    response.setHeader('content-type', 'application/json; charset=utf-8');
    response.setHeader('cache-control', 'no-store');
    response.setHeader('x-content-type-options', 'nosniff');
    if (request.method !== 'GET' || pathname !== '/positions') {
      response.writeHead(404).end(JSON.stringify({ error: 'NOT_FOUND' }));
      return;
    }
    response.writeHead(latest ? 200 : 503).end(JSON.stringify({
      health: poller.health(),
      ...(latest ? { batch: latest } : { error: 'NO_SNAPSHOT' }),
    }));
  });
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, HOST, resolve);
    });
  } catch (error) {
    server.close();
    throw error;
  }
  const run = poller.start(event => {
    if (event.type === 'snapshot') latest = event.batch;
  });
  let closed = false;
  return Object.freeze({
    host: HOST,
    port: server.address().port,
    health: () => poller.health(),
    run,
    async close() {
      if (closed) return;
      closed = true;
      await poller.stop();
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      latest = null;
    },
  });
}
