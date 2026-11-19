// The routed browser socket supplies the URL and protocols. Its native close event
// omits rejected upgrade headers, so own this single anonymous upgrade explicitly.
import playwrightUtils from 'playwright-core/lib/utilsBundle';

export function openSocket(route, origin, maxPayload, fail) {
  const upstream = new playwrightUtils.ws(route.url(), route.protocols(), {
    origin, maxPayload, handshakeTimeout: 10000, followRedirects: false, perMessageDeflate: false,
  });
  const ready = new Promise(resolve => {
    upstream.once('open', resolve);
    upstream.once('close', resolve);
  });
  let closing = false, failed = false;
  function report(failure) {
    if (closing || failed) return;
    failed = true;
    fail(failure);
  }
  upstream.on('unexpected-response', (_request, response) => {
    report({ status: response.statusCode, retryAfter: response.headers['retry-after'] });
    response.destroy();
    upstream.terminate();
  });
  upstream.on('error', error => report({ status: error.code === 'WS_ERR_UNSUPPORTED_MESSAGE_LENGTH' ? 413 : 503 }));
  return {
    ready,
    send: message => upstream.send(message),
    onMessage: fn => upstream.on('message', (data, binary) => fn(binary ? data : data.toString('utf8'))),
    onClose: fn => upstream.on('close', fn),
    close() {
      closing = true;
      if (upstream.readyState === upstream.CLOSED) return;
      const closed = new Promise(resolve => upstream.once('close', resolve));
      upstream.terminate();
      return closed;
    },
  };
}
