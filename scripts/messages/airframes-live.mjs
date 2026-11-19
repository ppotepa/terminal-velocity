import { chromium } from 'playwright-core';

export const liveUrl = 'https://app.airframes.io/messages/live';
const cardSelector = '.vue-recycle-scroller__item-view .mb-4.border';

/** Runs inside the rendered page. Return plain data only for the selected aircraft. */
export function readCards(scroller, { icao, selector }) {
  const messages = [];
  let cards = 0;
  let unsupported = false;
  for (const card of scroller.querySelectorAll(selector)) {
    cards++;
    const links = [...card.querySelectorAll('a[href]')];
    const aircraft = links.filter(link => link.pathname.startsWith('/airframes/'));
    const addresses = new Set(aircraft.map(link => link.textContent.trim().toUpperCase())
      .filter(text => /^[A-F0-9]{6}$/.test(text)));
    if (addresses.size !== 1 || !addresses.has(icao)) continue;
    const detail = links.find(link => /^\/messages\/[^/]+\/?$/.test(link.pathname)
      && link.origin === location.origin);
    const text = card.querySelector('.bg-inner')?.innerText.trim();
    if (!detail || !text || text.length > 32768) {
      unsupported = true;
      continue;
    }
    const station = links.find(link => link.pathname.startsWith('/stations/'));
    messages.push({ icao, messagePath: detail.pathname, text,
      station: station?.textContent.trim() || null });
  }
  return { messages, cards, unsupported };
}

export async function observePage(page, icao, windowMs = 10000) {
  await page.goto(liveUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
  if (new URL(page.url()).origin !== new URL(liveUrl).origin) throw new Error('Unexpected source origin');
  const scroller = page.locator('.messages-scroller');
  await scroller.waitFor({ state: 'attached', timeout: 10000 });
  const filter = page.getByPlaceholder('ICAO in hex', { exact: true });
  await filter.fill(icao, { timeout: 5000 });
  await filter.press('Enter');
  const messages = new Map();
  let sawCards = false;
  let unsupported = false;
  const deadline = Date.now() + windowMs;
  do {
    const sample = await scroller.evaluate(readCards, { icao, selector: cardSelector }, { timeout: 3000 });
    sawCards ||= sample.cards > 0;
    unsupported ||= sample.unsupported;
    for (const message of sample.messages) {
      messages.set(message.messagePath, message);
      if (messages.size >= 25) break;
    }
    if (messages.size >= 25 || Date.now() >= deadline) break;
    await page.waitForTimeout(Math.min(500, deadline - Date.now()));
  } while (true);
  const status = unsupported ? 'PARTIAL_LAYOUT' : messages.size ? 'OBSERVED'
    : sawCards ? 'NO_CONFIRMED_MATCH' : 'NO_OBSERVATIONS_COVERAGE_UNKNOWN';
  return { status, source: liveUrl, icao, messages: [...messages.values()] };
}

export async function acquire(strategy, address) {
  if (strategy === 'api') return { status: 'API_UNAVAILABLE', messages: [] };
  if (strategy !== 'crawl' || !/^[0-9a-f]{6}$/i.test(address ?? ''))
    throw new Error('Usage: npm run messages -- crawl <ICAO24> | api');
  const browser = await chromium.launch({
    chromiumSandbox: true,
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium-headless-shell',
    timeout: 15000,
  });
  try {
    const page = await browser.newPage({ serviceWorkers: 'block', acceptDownloads: false });
    return await observePage(page, address.toUpperCase());
  } finally {
    await browser.close();
  }
}
