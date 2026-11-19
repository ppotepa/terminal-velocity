// These budgets cover the page's own traffic for one anonymous browser window.
const maxRequests = 96, maxInFlight = 16, maxSocketMessages = 256;
const bootstrapTypes = new Set(['Document', 'Fetch', 'XHR', 'Script', 'Preflight']);
const maxResponseBytes = 8 * 1024 * 1024, maxTotalBytes = 24 * 1024 * 1024;

function firstParty(url, protocol) {
  return url.protocol === protocol && !url.port && !url.username && !url.password
    && (url.hostname === 'airframes.io' || url.hostname.endsWith('.airframes.io'))
    && !/(^|[./_-])(analytics|telemetry|stats|tracking|plausible|matomo|umami)([./_-]|$)/i.test(url.hostname + url.pathname);
}

export async function boundPage(context, page, liveUrl, cancel, syntheticShell) {
  let requests = 0, totalBytes = 0, navigationStarted = false, closed = false;
  const active = new Map();
  const session = await context.newCDPSession(page);
  let socket, server, socketMessages = 0;

  function reserve() {
    if (++requests <= maxRequests && active.size + Number(Boolean(socket)) < maxInFlight) return true;
    cancel({ status: 413 });
    return false;
  }
  function countBytes(bytes, responseBytes) {
    totalBytes += bytes;
    if (responseBytes <= maxResponseBytes && totalBytes <= maxTotalBytes) return true;
    cancel({ status: 413 });
    return false;
  }

  function checkResponse(status, headers, type) {
    if (Number(headers.get('content-length')) > maxResponseBytes) cancel({ status: 413 });
    if (status === 429 || status >= 500 || (status >= 400 && bootstrapTypes.has(type)))
      cancel({ status, retryAfter: headers.get('retry-after') });
  }

  // Fetch pauses each redirect hop before Chromium issues it. Network IDs span
  // a redirect chain, while each hop spends a separate request from the budget.
  async function intercept({ request, resourceType, requestId, networkId, responseStatusCode, responseStatusText, responseHeaders = [], responseErrorReason }) {
    if (responseErrorReason) {
      if (bootstrapTypes.has(resourceType)) cancel({ status: 503 });
      return session.send('Fetch.failRequest', { requestId, errorReason: responseErrorReason });
    }
    if (responseStatusCode) {
      const headers = new Map(responseHeaders.map(({ name, value }) => [name.toLowerCase(), value]));
      checkResponse(responseStatusCode, headers, resourceType);
      if (resourceType === 'Document' && responseStatusCode === 200) {
        // The budget is attached to this page target. Keep workers, subframes
        // and popups from creating other targets outside that accounting.
        const policy = { name: 'Content-Security-Policy',
          value: "sandbox allow-scripts allow-same-origin; worker-src 'none'; frame-src 'none'; form-action 'none'" };
        // Chromium applies the replacement policy when it receives a new document
        // response. Read decoded bytes in bounded chunks before supplying that body.
        if (Number(headers.get('content-length')) > maxResponseBytes) return;
        const { stream } = await session.send('Fetch.takeResponseBodyAsStream', { requestId });
        const chunks = [];
        let bytes = 0;
        try {
          while (!closed) {
            const part = await session.send('IO.read', { handle: stream, size: 65536 });
            const chunk = Buffer.from(part.data, part.base64Encoded ? 'base64' : 'utf8');
            bytes += chunk.length;
            if (!countBytes(chunk.length, bytes)) return;
            if (chunk.length) chunks.push(chunk);
            if (part.eof) break;
            if (!chunk.length) { cancel({ status: 503 }); return; }
          }
        } finally {
          await session.send('IO.close', { handle: stream });
        }
        if (closed) return;
        const decodedHeaders = responseHeaders.filter(({ name }) =>
          !['content-encoding', 'transfer-encoding', 'content-length'].includes(name.toLowerCase()));
        return session.send('Fetch.fulfillRequest', { requestId, responseCode: responseStatusCode,
          responsePhrase: responseStatusText || 'OK', responseHeaders: [...decodedHeaders, policy],
          body: Buffer.concat(chunks, bytes).toString('base64') });
      }
      return session.send('Fetch.continueResponse', { requestId });
    }
    active.delete(networkId);
    const navigation = resourceType === 'Document';
    // The rendered page obtains its anonymous stream session during startup.
    // Permit that one page-initiated POST without reading its request or response body.
    const publicStreamBootstrap = (resourceType === 'Fetch' || resourceType === 'XHR')
      && request.method === 'POST' && request.url === 'https://api.airframes.io/stream/visitor-token';
    const allowedMethod = request.method === 'GET' || publicStreamBootstrap
      || (request.method === 'OPTIONS' && (resourceType === 'Preflight' || resourceType === 'XHR' || resourceType === 'Fetch'));
    const allowed = !closed && firstParty(new URL(request.url), 'https:')
      && allowedMethod && (!navigation || (!navigationStarted && request.url === liveUrl)) && reserve();
    if (!allowed || (syntheticShell && !navigation)) {
      if (navigation) cancel({ status: 403 });
      try {
        return await session.send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' });
      } catch (error) {
        // Chromium can discard a removed image before acknowledging the block.
        if (!String(error.message).includes('Invalid InterceptionId')) throw error;
      }
      return;
    }
    navigationStarted ||= navigation;
    active.set(networkId, 0);
    if (syntheticShell) return session.send('Fetch.fulfillRequest', { requestId, responseCode: 200,
      responseHeaders: [{ name: 'Content-Type', value: 'text/html' }], body: Buffer.from(syntheticShell).toString('base64') });
    await session.send('Fetch.continueRequest', { requestId, interceptResponse: true });
  }
  session.on('Fetch.requestPaused', event => {
    void intercept(event).catch(() => { if (!closed) cancel({ status: 503 }); });
  });
  session.on('Network.responseReceived', ({ response, type }) => {
    const headers = new Map(Object.entries(response.headers).map(([k, v]) => [k.toLowerCase(), v]));
    checkResponse(response.status, headers, type);
  });
  session.on('Network.dataReceived', ({ requestId, dataLength }) => {
    const size = (active.get(requestId) ?? 0) + dataLength;
    active.set(requestId, size);
    countBytes(dataLength, size);
  });
  for (const event of ['Network.loadingFinished', 'Network.loadingFailed'])
    session.on(event, ({ requestId }) => active.delete(requestId));
  await session.send('Network.enable');
  await session.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });

  await context.routeWebSocket('**/*', route => {
    if (closed || syntheticShell || !firstParty(new URL(route.url()), 'wss:')) return route.close();
    if (!reserve()) return route.close();
    if (socket) {
      cancel({ status: 413 });
      return route.close();
    }
    socket = route;
    server = route.connectToServer();
    function forward(destination, message) {
      const size = Buffer.byteLength(message);
      if (closed) return;
      if (++socketMessages > maxSocketMessages) { cancel({ status: 413 }); return; }
      if (countBytes(size, size)) destination.send(message);
    }
    server.onMessage(message => forward(route, message));
    route.onMessage(message => forward(server, message));
    // Retry the whole scoped window if either end disappears during observation.
    const disconnected = () => { if (!closed) cancel({ status: 503 }); };
    route.onClose(disconnected);
    server.onClose(disconnected);
  });
  return async () => {
    closed = true;
    await Promise.all([socket?.close(), server?.close()]);
  };
}
