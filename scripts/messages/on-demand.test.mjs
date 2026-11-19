import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { liveUrl } from './airframes-live.mjs';

const bootstrap = 'https://api.airframes.io/stream/visitor-token';
const stream = 'wss://ws.airframes.io/socket.io/?transport=websocket';
const analytics = 'https://analytics.airframes.io/track';
const outside = new URL('/outside', liveUrl).href;

function card(icao, id) {
  return `<div class="vue-recycle-scroller__item-view"><div class="mb-4 border">
    <a href="/airframes/fixture">${icao}</a><a href="/messages/${id}">Details</a>
    <div class="bg-inner">Synthetic payload ${id}</div></div></div>`;
}

const shell = `<!doctype html><main></main><script>
fetch('${analytics}').catch(() => {});
(async () => {
  const config = await (await fetch('${bootstrap}', { method: 'POST' })).json();
  const socket = new WebSocket(config.stream);
  socket.onopen = () => socket.send('ready');
  socket.onmessage = event => {
    if (event.data === 'disconnect') {
      document.querySelector('main').innerHTML = '<div class="messages-scroller"></div>';
      socket.close();
      return;
    }
    document.querySelector('main').innerHTML = '<div class="messages-scroller">' + event.data + '</div>';
  };
})();
</script>`;

// Replace only the upstream peer and HTTP responses. Chromium still performs
// navigation, redirects, cross-origin fetch, socket events and DOM rendering.
async function crawl(t, { denied, redirect, partial, disconnect, stop } = {}) {
  const requested = [], blocked = [], sockets = [], closed = [], output = [];
  const launch = chromium.launch.bind(chromium);
  t.mock.method(chromium, 'launch', async options => {
    const browser = await launch(options);
    const newContext = browser.newContext.bind(browser);
    browser.newContext = async config => {
      const context = await newContext({ ...config, offline: true });
      const newSession = context.newCDPSession.bind(context);
      context.newCDPSession = async page => {
        const session = await newSession(page);
        const urls = new Map();
        session.on('Fetch.requestPaused', e => urls.set(e.requestId, e.request.url));
        const send = session.send.bind(session);
        session.send = async (method, params) => {
          if (method === 'Fetch.failRequest') blocked.push(urls.get(params.requestId));
          if (method !== 'Fetch.continueRequest') return send(method, params);
          const url = urls.get(params.requestId);
          requested.push(url);
          let responseCode = 404, body = '', headers = {};
          if (url === liveUrl) {
            responseCode = redirect ? 302 : 200;
            headers = redirect ? { Location: outside } : { 'Content-Type': 'text/html' };
            body = redirect ? '' : shell;
          } else if (url === bootstrap) {
            responseCode = denied ?? 200;
            headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
            body = JSON.stringify({ stream });
          }
          return send('Fetch.fulfillRequest', { requestId: params.requestId, responseCode,
            responseHeaders: Object.entries(headers).map(([name, value]) => ({ name, value })),
            body: Buffer.from(body).toString('base64') });
        };
        return session;
      };
      const routeWebSocket = context.routeWebSocket.bind(context);
      context.routeWebSocket = (pattern, handler) => routeWebSocket(pattern, route => {
        route.connectToServer = () => {
          sockets.push(route.url());
          let receive;
          return {
            onMessage(handler) { receive = handler; },
            onClose() {},
            close: async () => { closed.push(route.url()); },
            send(message) {
              if (message !== 'ready') return;
              if (stop) { process.emit('SIGINT'); return; }
              if (disconnect && sockets.length === 1) { receive('disconnect'); return; }
              receive(card('ABC123', 'selected') + card('DEF456', 'other') + (partial ? card('ABC123', 'live') : ''));
            },
          };
        };
        return handler(route);
      });
      return context;
    };
    return browser;
  });
  t.mock.method(console, 'log', value => output.push(value));
  const argv = process.argv, previousCode = process.exitCode;
  let code;
  try {
    process.argv = [process.execPath, 'cli.mjs', 'crawl', 'ABC123'];
    process.exitCode = 0;
    await import('./cli.mjs?case=' + encodeURIComponent(t.name));
    code = process.exitCode;
  } finally {
    process.argv = argv;
    process.exitCode = previousCode;
  }
  assert.equal(output.length, 1);
  assert.ok(!requested.includes(analytics));
  assert.deepEqual(closed, sockets);
  return { result: JSON.parse(output[0]), requested, blocked, sockets, code };
}

test('crawl reconnects after the page socket closes and prints only the selected rendered card', async t => {
  const { result, code, requested, sockets } = await crawl(t, { disconnect: true });
  assert.deepEqual(requested.filter(url => url === bootstrap), [bootstrap, bootstrap]);
  assert.deepEqual(sockets, [stream, stream]);
  assert.equal(code, 0);
  assert.equal(result.status, 'OBSERVED');
  assert.equal(result.accepted, 0);
  assert.deepEqual(result.messages, [{ icao: 'ABC123', messagePath: '/messages/selected',
    text: 'Synthetic payload selected', station: null }]);
});

test('a mixed-layout CLI preview keeps validated cards and reports partial success', async t => {
  const { result, code } = await crawl(t, { partial: true });
  assert.equal(code, 2);
  assert.equal(result.status, 'PARTIAL_LAYOUT');
  assert.equal(result.accepted, 0);
  assert.deepEqual(result.messages.map(row => row.messagePath), ['/messages/selected']);
});

for (const denied of [401, 403]) test(`bootstrap HTTP ${denied} ends the crawl after one request`, async t => {
  const { result, requested, sockets } = await crawl(t, { denied });
  assert.equal(result.status, 'PERMANENT_FAILURE');
  assert.equal(requested.filter(url => url === bootstrap).length, 1);
  assert.deepEqual(sockets, []);
  assert.deepEqual(result.messages, []);
});

test('a same-origin redirect outside the live page is blocked before the destination is fetched', async t => {
  const { result, requested, blocked } = await crawl(t, { redirect: true });
  assert.equal(result.status, 'PERMANENT_FAILURE');
  assert.deepEqual(requested, [liveUrl]);
  assert.ok(blocked.includes(outside));
});

test('cancelling the CLI closes the active socket without another page attempt', async t => {
  const { result, sockets } = await crawl(t, { stop: true });
  assert.equal(result.status, 'STOPPED');
  assert.deepEqual(result.messages, []);
  assert.deepEqual(sockets, [stream]);
});
