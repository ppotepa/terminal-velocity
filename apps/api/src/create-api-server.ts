import { createServer, type Server } from 'node:http';
import { createDemoTracker, createDemoMapReader, type DemoTracker } from '@airframes/backend/demo';
import type { MapReader } from '@airframes/backend/map';
import { sendProblem } from './http/send-problem.ts';
import { handleRequest } from './routing/handle-request.ts';
import type { ReadApiHealth } from './http/api-health.ts';

/** Creates an unbound HTTP server. The executable binds it exclusively to loopback. */
export function createApiServer(tracker: DemoTracker = createDemoTracker(),
  readHealth: ReadApiHealth = async () => ({ status: 'ok', mode: 'demo', storage: 'memory' }),
  mapReader: MapReader = createDemoMapReader(tracker)): Server {
  return createServer({
    maxHeaderSize: 8 * 1024,
    requestTimeout: 15_000,
    headersTimeout: 10_000,
    keepAliveTimeout: 5_000,
  }, (request, response) => {
    // A disconnected client can emit a late stream error after the body reader has finished.
    // The connection is already unusable; do not turn that transport failure into a process crash.
    request.on('error', () => {});
    void handleRequest(tracker, request, response, readHealth, mapReader).catch((error: unknown) => {
      request.resume();
      sendProblem(response, error);
    });
  });
}
