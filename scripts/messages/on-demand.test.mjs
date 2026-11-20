import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash, X509Certificate } from 'node:crypto';
import { once } from 'node:events';
import { createSecureServer } from 'node:http2';
import test from 'node:test';
import { promisify } from 'node:util';
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
history.replaceState(null, '', '?icao=ABC123');
fetch('${analytics}').catch(() => {});
(async () => {
  const config = await (await fetch('${bootstrap}', { method: 'POST' })).json();
  const socket = new WebSocket(config.stream);
  socket.onopen = () => socket.send('ready');
  socket.onmessage = event => {
    document.querySelector('main').innerHTML = '<div class="messages-scroller">' + event.data + '</div>';
  };
})();
</script>`;

// HTTP/2 supplies :status without a reason phrase. Keep TLS material in memory
// and resolve only the document, bootstrap and socket hosts to loopback.
async function loopbackProvider(t, { upgradeStatus, denied, redirect, partial, disconnect, onReady, burst }) {
  const { stdout: pem } = await promisify(execFile)('openssl', ['req', '-x509', '-newkey', 'ec',
    '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-subj', '/CN=app.airframes.io',
    '-days', '1', '-keyout', '-', '-out', '-']);
  const cert = pem.slice(pem.indexOf('-----BEGIN CERTIFICATE-----'));
  const key = pem.slice(0, pem.indexOf('-----BEGIN CERTIFICATE-----'));
  const spki = new X509Certificate(cert).publicKey.export({ type: 'spki', format: 'der' });
  const pin = createHash('sha256').update(spki).digest('base64');
  const server = createSecureServer({ cert, key, allowHTTP1: true });
  const paths = [], sockets = [], bootstraps = [], peers = new Set();
  server.on('upgrade', (req, socket) => {
    peers.add(socket);
    socket.once('close', () => peers.delete(socket));
    socket.on('error', error => { if (error.code !== 'ECONNRESET') throw error; });
    sockets.push('wss://' + req.headers.host + req.url);
    assert.equal(req.headers.origin, new URL(liveUrl).origin);
    if (upgradeStatus === 'drop') return socket.destroy();
    if (upgradeStatus) {
      socket.end(`HTTP/1.1 ${upgradeStatus} Denied\r\nContent-Length: 0\r\n\r\n`);
      return;
    }
    const accept = createHash('sha1').update(req.headers['sec-websocket-key']
      + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
      + `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
    const sendFixture = () => {
      if (onReady) { onReady(); return; }
      if (disconnect && sockets.length === 1) { socket.end(Buffer.from([0x88, 0])); return; }
      const body = Buffer.from(burst
        ? Array.from({ length: 26 }, (_, i) => card('ABC123', String(i))).join('')
        : card('ABC123', 'selected') + card('DEF456', 'other') + (partial ? card('ABC123', 'live') : ''));
      const header = Buffer.from([0x81, 126, 0, 0]);
      header.writeUInt16BE(body.length, 2);
      socket.write(Buffer.concat([header, body]));
    };
    // Normal fixture frames can follow the handshake immediately. Waiting for
    // an unrelated client 'ready' frame made the rendered-card test timing vary.
    if (onReady || disconnect) socket.once('data', sendFixture);
    else setImmediate(sendFixture);
    socket.on('end', () => socket.end());
  });
  server.on('stream', (response, headers) => {
    if (headers[':authority'] === new URL(bootstrap).host && headers[':path'] === new URL(bootstrap).pathname) {
      bootstraps.push(headers[':method']);
      response.respond({ ':status': denied ?? 200, 'content-type': 'application/json', 'access-control-allow-origin': '*' });
      response.end(JSON.stringify({ stream }));
      return;
    }
    paths.push(headers[':path']);
    if (redirect) {
      response.respond({ ':status': 302, location: outside });
      response.end();
      return;
    }
    response.respond({ ':status': 200, 'content-type': 'text/html' });
    // A frame navigation blocked before reaching the loopback server proves Chromium
    // enforced the response header that the document interceptor appended.
    response.end(shell + `<script>
      document.addEventListener('securitypolicyviolation', event => console.log(event.effectiveDirective));
      const frame = document.createElement('iframe'); frame.src = '/fixture-child'; document.body.append(frame);
    </script>`);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    for (const peer of peers) peer.destroy();
    return new Promise(resolve => server.close(resolve));
  });
  return { paths, sockets, bootstraps, peers, pin, port: server.address().port };
}

async function crawl(t, { stop, ...options } = {}) {
  let child;
  const provider = await loopbackProvider(t, { ...options, onReady: stop ? () => child.kill('SIGINT') : undefined });
  child = spawn(process.execPath, ['scripts/messages/synthetic-browser-cli.mjs', String(provider.port), provider.pin],
    { stdio: ['ignore', 'pipe', 'inherit'], cwd: new URL('../../', import.meta.url), timeout: 90000, killSignal: 'SIGKILL' });
  let stdout = '';
  child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
  const [code, signal] = await once(child, 'close');
  assert.equal(signal, null);
  const lines = stdout.trim().split('\n');
  assert.equal(lines.length, 2);
  const [result, evidence] = lines.map(line => JSON.parse(line));
  assert.equal(evidence.browsersClosed, true);
  assert.ok(!evidence.requested.includes(analytics));
  assert.deepEqual(provider.bootstraps, evidence.requested.filter(url => url === bootstrap).map(() => 'POST'));
  return { result, ...evidence, sockets: provider.sockets, code, provider };
}

test('a phrase-less HTTP/2 document enforces its policy and previews the selected card after bootstrap', async t => {
  const { result, code, documentResponses, pageLogs, blocked, provider } = await crawl(t);
  assert.deepEqual(provider.paths, ['/messages/live']);
  assert.deepEqual(documentResponses, [[200, '']]);
  assert.ok(pageLogs.includes('frame-src'), JSON.stringify(pageLogs));
  assert.ok(blocked.includes(analytics));
  assert.equal(code, 0);
  assert.equal(result.status, 'OBSERVED');
  assert.equal(result.accepted, 0);
  assert.deepEqual(result.messages, [{ icao: 'ABC123', messagePath: '/messages/selected',
    text: 'Synthetic payload selected', station: null }]);
});

test('a filter query on the live path prints the selected rendered card after one attempt', async t => {
  const { result, code, requested, sockets } = await crawl(t);
  assert.deepEqual(requested.filter(url => url === liveUrl), [liveUrl]);
  assert.deepEqual(requested.filter(url => url === bootstrap), [bootstrap]);
  assert.deepEqual(sockets, [stream]);
  assert.equal(code, 0);
  assert.equal(result.status, 'OBSERVED');
  assert.deepEqual(result.messages, [{ icao: 'ABC123', messagePath: '/messages/selected',
    text: 'Synthetic payload selected', station: null }]);
});

test('a 26-card CLI window prints the first 25 validated cards as a truncated preview', async t => {
  const { result, code, requested } = await crawl(t, { burst: true });
  assert.deepEqual(requested.filter(url => url === liveUrl), [liveUrl]);
  assert.deepEqual(requested.filter(url => url === bootstrap), [bootstrap]);
  assert.equal(code, 2);
  assert.equal(result.status, 'TRUNCATED');
  assert.equal(result.inspected, 25);
  assert.equal(result.accepted, 0);
  assert.deepEqual(result.messages, Array.from({ length: 25 }, (_, i) => ({
    icao: 'ABC123', messagePath: '/messages/' + i, text: 'Synthetic payload ' + i, station: null,
  })));
});

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

test('SIGINT stops the CLI browser and returns control to the embedding process', async t => {
  const { result, code, provider } = await crawl(t, { stop: true });
  assert.equal(code, 1);
  assert.equal(result.status, 'STOPPED');
  assert.deepEqual(result.messages, []);
  assert.deepEqual(provider.sockets, [stream]);
  assert.deepEqual(provider.bootstraps, ['POST']);
  await Promise.all([...provider.peers].map(socket => once(socket, 'close', { signal: AbortSignal.timeout(3000) })));
});

for (const [status, expected] of [[429, 'RATE_LIMITED'], [401, 'PERMANENT_FAILURE'], [403, 'PERMANENT_FAILURE'], ['drop', 'TEMPORARY_FAILURE']]) {
  test(`Chromium rejects a native WebSocket upgrade with HTTP ${status} without another lookup`, async t => {
    const { result, requested, sockets } = await crawl(t, { upgradeStatus: status });
    assert.equal(result.status, expected);
    assert.deepEqual(sockets, [stream]);
    assert.deepEqual(requested.filter(url => url === bootstrap), [bootstrap]);
    assert.equal(result.accepted, 0);
    assert.deepEqual(result.messages, []);
  });
}
