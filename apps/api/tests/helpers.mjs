import { once } from 'node:events';
import { createDemoTracker, createDemoMapReader } from '@airframes/backend/demo';
import { createApiServer } from '../src/create-api-server.ts';

export const NOW = Date.parse('2026-11-18T12:01:00.000Z');
export const AIRCRAFT_ID = 'ac_demo-001';
export const message = overrides => ({
  messageId: 'msg_demo-001', observedAt: '2026-11-18T12:00:00.000Z',
  bearer: 'VDL2', text: 'Synthetic demo status', icao24: 'D00001', ...overrides,
});

export async function startServer(t, tracker = createDemoTracker({ now: () => NOW })) {
  const server = createApiServer(tracker, undefined, createDemoMapReader(tracker, () => NOW));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected a TCP server address');
  t.after(() => new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  return { base: `http://127.0.0.1:${address.port}`, server };
}

export async function post(base, value, extraHeaders = {}) {
  return fetch(`${base}/api/v1/demo/messages`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...extraHeaders }, body: JSON.stringify(value),
  });
}

export function stubTracker(overrides = {}) {
  const absent = async () => ({ ok: false, error: { code: 'NOT_FOUND', message: 'Not found.' } });
  return {
    ingest: absent, getAircraft: absent, getMessages: absent, getMessage: absent,
    listAircraft: async () => ({ ok: true, value: [] }), ...overrides,
  };
}
