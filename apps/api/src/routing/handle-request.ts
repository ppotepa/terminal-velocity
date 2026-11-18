import type { DemoTracker } from '@airframes/backend/demo';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { HttpProblem } from '../http/http-problem.ts';
import { readJsonBody } from '../http/read-json-body.ts';
import { sendApiResult } from '../http/send-api-result.ts';
import { sendJson } from '../http/send-json.ts';
import { matchRoute } from './match-route.ts';

export async function handleRequest(tracker: DemoTracker, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const route = matchRoute(request.url ?? '/');
  if (request.method !== route.method) {
    throw new HttpProblem(405, 'METHOD_NOT_ALLOWED', `Use ${route.method} for this endpoint.`, { Allow: route.method });
  }
  switch (route.name) {
    case 'health':
      sendJson(response, 200, { data: { status: 'ok', mode: 'demo', storage: 'memory' } });
      return;
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
