// Exercise HTTP upgrade parsing and WebSocket framing entirely in memory.
// Only the TLS stream is substituted. No DNS lookup or listener is needed.
import tls from 'node:tls';
import { createServer } from 'node:http';
import { duplexPair } from 'node:stream';
import assert from 'node:assert/strict';
import playwrightUtils from 'playwright-core/lib/utilsBundle';

export function syntheticUpgrade(t, { status, onMessage, onClose }) {
  const upgrades = [];
  const http = createServer();
  const ws = new playwrightUtils.wsServer({ noServer: true });
  http.on('upgrade', (request, socket, head) => {
    upgrades.push('wss://' + request.headers.host + request.url);
    assert.equal(request.headers.origin, 'https://app.airframes.io');
    if (status) {
      socket.end(`HTTP/1.1 ${status} Denied\r\nRetry-After: 60\r\nContent-Length: 0\r\n\r\n`);
      return;
    }
    ws.handleUpgrade(request, socket, head, peer => {
      peer.on('message', data => onMessage(peer, data.toString()));
      peer.on('close', () => onClose?.());
    });
  });
  t.mock.method(tls, 'connect', options => {
    assert.equal(options.servername, 'ws.airframes.io');
    const [client, server] = duplexPair();
    // A physical socket propagates termination to its peer.
    client.on('close', () => server.destroy());
    server.on('close', () => client.destroy());
    http.emit('connection', server);
    return client;
  });
  t.after(() => ws.close());
  return upgrades;
}
