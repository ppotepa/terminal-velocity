import { createProviderConnector } from '../../packages/backend/src/modules/source-connectors/composition/create-provider-connector.ts';
import { pageUrl, maxCards, maxEnvelopeBytes, maxWindowBytes } from '../../packages/backend/src/modules/source-connectors/infrastructure/airframes/page-window.ts';
import { boundPage } from './page-budget.mjs';
import { syntheticShell } from './synthetic-shell.mjs';

export const liveUrl = pageUrl;
const cardSelector = '.vue-recycle-scroller__item-view .mb-4.border';

/** Runs inside the rendered page. Return plain data only for the selected aircraft. */
export function readCards(scroller, { icao, selector, maxCards, maxEnvelopeBytes, maxWindowBytes, envelopeOverhead, liveUrl }) {
  const scope = new URL(liveUrl);
  if (location.origin !== scope.origin || location.pathname !== scope.pathname) return null;
  const messages = new Map();
  let cards = 0;
  let unsupported = false;
  let overflow = false;
  let bytes = 0;
  for (const card of scroller.querySelectorAll(selector)) {
    cards++;
    const links = [...card.querySelectorAll('a[href]')].filter(link => link.origin === location.origin);
    const aircraft = links.filter(link => link.pathname.startsWith('/airframes/'));
    const addresses = new Set(aircraft.map(link => link.textContent.trim().toUpperCase())
      .filter(text => /^[A-F0-9]{6}$/.test(text)));
    if (addresses.size !== 1 || !addresses.has(icao)) continue;
    const detail = links.find(link => /^\/messages\/[^/]+\/?$/.test(link.pathname)
      && !['live', 'ar', 'history', 'search'].includes(link.pathname.split('/')[2]));
    const text = card.querySelector('.bg-inner')?.innerText.trim();
    if (!detail || !text || text.length > 32768) {
      unsupported = true;
      continue;
    }
    const station = links.find(link => link.pathname.startsWith('/stations/'));
    if (detail.pathname.length > 256) { unsupported = true; continue; }
    const message = { icao, messagePath: detail.pathname, text,
      station: station?.textContent.trim().slice(0, 256) || null };
    const size = new TextEncoder().encode(JSON.stringify(message)).length + envelopeOverhead;
    if (size > maxEnvelopeBytes) { unsupported = true; continue; }
    if (messages.has(message.messagePath)) continue;
    if (messages.size === maxCards || bytes + size > maxWindowBytes) { overflow = true; break; }
    bytes += size;
    messages.set(message.messagePath, message);
  }
  return { messages: [...messages.values()], cards, unsupported, overflow };
}

export async function observePage(page, icao, windowMs = 10000, expiresAt = Infinity) {
  if (!/^[A-F0-9]{6}$/.test(icao) || !Number.isSafeInteger(windowMs) || windowMs < 0 || windowMs > 10000)
    throw new Error('Invalid observation window or aircraft scope');
  const expected = new URL(liveUrl);
  const inScope = href => {
    const url = new URL(href);
    return url.origin === expected.origin && url.pathname === expected.pathname;
  };
  const denied = { status: 'HTTP_FAILURE', httpStatus: 403 };
  let leftScope = false;
  const onNavigate = frame => {
    if (frame === page.mainFrame() && !inScope(frame.url())) leftScope = true;
  };
  page.on('framenavigated', onNavigate);
  try {
    return await sampleWindow();
  } catch (error) {
    if (leftScope) return denied;
    throw error;
  } finally {
    page.off('framenavigated', onNavigate);
  }

  async function sampleWindow() {
    const remaining = limit => Math.max(1, Math.min(limit, expiresAt - Date.now()));
    const response = await page.goto(liveUrl, { waitUntil: 'domcontentloaded', timeout: remaining(20000) });
    if (leftScope || !inScope(page.url())) return denied;
    if (!response || response.status() !== 200) return { status: 'HTTP_FAILURE',
      httpStatus: response?.status() ?? 503, retryAfter: await response?.headerValue('retry-after') };
    const scroller = page.locator('.messages-scroller');
    await scroller.waitFor({ state: 'attached', timeout: remaining(10000) });
    // The site can unmount the live list when its search form is submitted.
    // Match inside the rendered live list without navigating into archive search.
    const messages = new Map();
    let sawCards = false;
    let unsupported = false;
    let overflow = false;
    let bytes = 0;
    // Reserve the wrapper once per card, including room for the retrieval timestamp.
    const envelopeOverhead = Buffer.byteLength(JSON.stringify({ source: liveUrl, raw: null,
      retrievedAt: Number.MAX_SAFE_INTEGER })) - 4; // JSON null is replaced by the serialized card.
    const deadline = Math.min(Date.now() + windowMs, expiresAt);
    do {
      // A sample needs a browser round trip. Once a validated sample exists,
      // finish the window before the outer deadline makes that round trip fail.
      if (sawCards && deadline - Date.now() < 100) break;
      const sample = await scroller.evaluate(readCards, { icao, selector: cardSelector, maxCards, maxEnvelopeBytes, maxWindowBytes, envelopeOverhead, liveUrl }, { timeout: remaining(3000) });
      if (!sample || leftScope) return denied;
      sawCards ||= sample.cards > 0;
      unsupported ||= sample.unsupported;
      overflow ||= sample.overflow;
      for (const message of sample.messages) {
        const previous = messages.get(message.messagePath);
        bytes += Buffer.byteLength(JSON.stringify(message));
        bytes += previous ? -Buffer.byteLength(JSON.stringify(previous)) : envelopeOverhead;
        if (bytes > maxWindowBytes || (!previous && messages.size === maxCards)) {
          overflow = true;
          break;
        }
        messages.set(message.messagePath, message);
      }
      if (overflow || messages.size === maxCards || Date.now() >= deadline) break;
      await page.waitForTimeout(Math.min(500, deadline - Date.now()));
    } while (Date.now() < deadline);
    if (leftScope || !inScope(page.url())) return denied;
    const status = overflow ? 'TRUNCATED' : unsupported ? 'PARTIAL_LAYOUT' : messages.size ? 'OBSERVED'
      : sawCards ? 'NO_CONFIRMED_MATCH' : 'NO_OBSERVATIONS_COVERAGE_UNKNOWN';
    return { status, source: liveUrl, icao, messages: [...messages.values()] };
  }
}

async function readBrowserWindow(icao, signal, synthetic) {
  signal.throwIfAborted();
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({
    chromiumSandbox: true,
    handleSIGINT: false,
    handleSIGTERM: false,
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium-headless-shell',
    timeout: 15000,
  });
  let failure, dispose;
  let closing;
  const close = () => closing ??= (async () => {
    try { await dispose?.(); } finally { await browser.close(); }
  })();
  const abort = () => { void close().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    signal.throwIfAborted();
    const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false, offline: synthetic });
    const page = await context.newPage();
    dispose = await boundPage(context, page, liveUrl, response => {
      failure ??= response;
      abort();
    }, synthetic ? syntheticShell : undefined);
    const body = await observePage(page, icao, synthetic ? 500 : 10000, Date.now() + 10000);
    if (failure) return failure;
    return body.status === 'HTTP_FAILURE' ? { status: body.httpStatus, retryAfter: body.retryAfter }
      : { status: 200, body };
  } catch (error) {
    if (failure) return failure;
    throw error;
  } finally {
    signal.removeEventListener('abort', abort);
    await close();
  }
}

export async function acquire(strategy, address, signal) {
  if (!['api', 'crawl', 'dry-run'].includes(strategy) || (strategy !== 'api' && !/^[0-9a-f]{6}$/i.test(address ?? '')))
    throw new Error('Invalid acquisition scope');
  const synthetic = strategy === 'dry-run';
  const messages = [];
  let observed, inspected = 0;
  const connection = createProviderConnector(strategy === 'api' ? 'api' : 'crawl', address?.toUpperCase() ?? '', {
    kind: 'ON_DEMAND_PREVIEW',
    inspect(delivery) {
      inspected++;
      if (!synthetic) messages.push(delivery.raw);
    },
    async read(icao, signal) {
      const response = await readBrowserWindow(icao, signal, synthetic);
      observed = response.body?.status;
      return response;
    },
  });
  const outcome = await connection.start(signal);
  const status = !synthetic && outcome === 'COMPLETE' ? observed : outcome;
  const summary = { status, inspected, ...connection.health() };
  if (synthetic) return summary;
  if (strategy === 'api') return { ...summary, messages };
  return { ...summary, source: liveUrl, icao: address.toUpperCase(), messages };
}
