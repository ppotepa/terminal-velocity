// Guard the browser's own subresource traffic as well as the outer page-attempt budget.
export async function boundPage(context, page, liveUrl, cancel) {
  const maxRequests = 96, maxInFlight = 16;
  const maxResponseBytes = 8 * 1024 * 1024, maxTotalBytes = 24 * 1024 * 1024;
  let requests = 0, totalBytes = 0, navigationStarted = false;
  const origin = new URL(liveUrl).origin;
  const active = new Set();
  context.on('requestfinished', request => active.delete(request));
  context.on('requestfailed', request => active.delete(request));
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (++requests > maxRequests || active.size >= maxInFlight) {
      cancel({ status: 413 });
      return;
    }
    if (url.origin !== origin || request.method() !== 'GET'
      || url.username || url.password || (request.isNavigationRequest() && (navigationStarted || url.href !== liveUrl)))
      return route.abort();
    navigationStarted ||= request.isNavigationRequest();
    active.add(request);
    await route.fallback();
  });
  const session = await context.newCDPSession(page);
  const received = new Map();
  session.on('Network.responseReceived', ({ response }) => {
    const length = Object.entries(response.headers).find(([key]) => key.toLowerCase() === 'content-length');
    if (length && Number(length[1]) > maxResponseBytes) cancel({ status: 413 });
    if (response.status === 429 || response.status >= 500) {
      const header = Object.entries(response.headers).find(([key]) => key.toLowerCase() === 'retry-after');
      cancel({ status: response.status, retryAfter: header?.[1] });
    }
  });
  session.on('Network.dataReceived', ({ requestId, dataLength }) => {
    totalBytes += dataLength;
    const size = (received.get(requestId) ?? 0) + dataLength;
    received.set(requestId, size);
    if (size > maxResponseBytes || totalBytes > maxTotalBytes) cancel({ status: 413 });
  });
  for (const event of ['Network.loadingFinished', 'Network.loadingFailed'])
    session.on(event, ({ requestId }) => received.delete(requestId));
  await session.send('Network.enable');
  // Chromium also applies this origin restriction to HTTP redirect hops.
  await session.send('Network.setBlockedURLs', {
    urlPatterns: [{ urlPattern: origin + '/*', block: false }],
    urls: ['http://*', 'https://*'],
  });
}
