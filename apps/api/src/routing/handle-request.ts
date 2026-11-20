import type { DemoTracker } from '@airframes/backend/demo';
import type { MapReader } from '@airframes/backend/map';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { HttpProblem } from '../http/http-problem.ts';
import { readJsonBody } from '../http/read-json-body.ts';
import { sendApiResult } from '../http/send-api-result.ts';
import { sendJson } from '../http/send-json.ts';
import { matchRoute } from './match-route.ts';
import type { ReadApiHealth } from '../http/api-health.ts';
import { mapHttpPage, parseMapViewport } from './map-viewport.ts';

export async function handleRequest(tracker: DemoTracker, request: IncomingMessage, response: ServerResponse,
  readHealth: ReadApiHealth, mapReader: MapReader): Promise<void> {
  const route = matchRoute(request.url ?? '/');
  if (request.method !== route.method) {
    throw new HttpProblem(405, 'METHOD_NOT_ALLOWED', `Use ${route.method} for this endpoint.`, { Allow: route.method });
  }
  switch (route.name) {
    case 'health': {
      const health = await readHealth();
      sendJson(response, health.status === 'ok' ? 200 : 503, { data: health });
      return;
    }
    case 'map-aircraft': {
      const address = request.socket.remoteAddress;
      if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1')
        throw new HttpProblem(403, 'PRIVATE_ENDPOINT', 'The map snapshot is available on loopback only.');
      const query = parseMapViewport(route.search);
      try { sendJson(response, 200, mapHttpPage(await mapReader.read(query))); }
      catch (error) {
        if (error instanceof RangeError && error.message === 'STALE_MAP_CURSOR')
          throw new HttpProblem(409, 'STALE_MAP_CURSOR', 'The map changed; request a new first page.');
        throw error;
      }
      return;
    }
    case 'aircraft-list':
      sendApiResult(response, await tracker.listAircraft());
      return;
    case 'aircraft':
      sendApiResult(response, await tracker.getAircraft(route.id));
      return;
    case 'aircraft-messages':
      sendApiResult(response, await tracker.getMessages(route.id));
      return;
    case 'message':
      sendApiResult(response, await tracker.getMessage(route.id));
      return;
    case 'demo-ingest': {
      const result = await tracker.ingest(await readJsonBody(request));
      sendApiResult(response, result, result.ok && result.value.created ? 201 : 200);
    }
  }
}
