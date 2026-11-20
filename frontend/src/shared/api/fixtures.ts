import type { components } from './generated';

export type ApiFixtures = {
  watchRules: components['schemas']['WatchRulePage'];
  mapSnapshot: components['schemas']['MapSnapshot'];
  messages: components['schemas']['MessagePage'];
  alertEvents: components['schemas']['AlertEventPage'];
};

/** A deterministic, explicitly synthetic fetch transport for API-backed UI development. */
export function createFixtureFetch(fixtures: ApiFixtures): typeof fetch {
  return async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const path = new URL(request.url, window.location.origin).pathname.replace(/\/+$/, '');
    let body: unknown;
    if (request.method === 'GET' && path.endsWith('/watch-rules')) body = fixtures.watchRules;
    else if (request.method === 'GET' && path.endsWith('/map/snapshot')) body = fixtures.mapSnapshot;
    else if (request.method === 'GET' && path.endsWith('/messages')) body = fixtures.messages;
    else if (request.method === 'GET' && path.endsWith('/alert-events')) body = fixtures.alertEvents;
    else body = { error: { code: 'not_found', message: 'No synthetic fixture is defined for this request.', requestId: 'fixture-miss', details: [] } };
    const status = body && typeof body === 'object' && 'error' in body ? 501 : 200;
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'x-data-mode': 'synthetic-fixture' } });
  };
}
