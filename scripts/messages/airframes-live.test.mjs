import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { acquire, liveUrl, observePage } from './airframes-live.mjs';

test('API strategy is unavailable without starting a browser', async () => {
  assert.equal((await acquire('api')).status, 'API_UNAVAILABLE');
});

test('rendered crawl isolates aircraft and deduplicates repeated cards', async () => {
  const browser = await chromium.launch({ chromiumSandbox: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium-headless-shell' });
  try {
    const page = await browser.newPage();
    const card = (icao, id) => `<div class="vue-recycle-scroller__item-view"><div class="mb-4 border">
      <a href="/airframes/test">${icao}</a><a href="/messages/${id}">details</a>
      <div class="bg-inner">Synthetic message</div></div></div>`;
    await page.route(liveUrl, route => route.fulfill({contentType: 'text/html',
      body: '<input placeholder="ICAO in hex"><div class="messages-scroller">' +
        card('ABC123','one') + card('ABC123','one') + card('DEF456','two') + '</div>'}));
    const result = await observePage(page, 'ABC123', 0);
    assert.equal(result.status, 'OBSERVED');
    assert.deepEqual(result.messages, [{icao:'ABC123', messagePath:'/messages/one', text:'Synthetic message', station:null}]);
    assert.equal((await observePage(page, '123456', 0)).status, 'NO_CONFIRMED_MATCH');
    async function replaceCards(html) {
      await page.unroute(liveUrl);
      await page.route(liveUrl, route => route.fulfill({contentType:'text/html',
        body:'<div class="messages-scroller">' + html + '</div>'}));
      return observePage(page, 'ABC123', 0);
    }
    assert.equal((await replaceCards(card('ABC123','one').replace('/airframes/test',
      'https://other.invalid/airframes/test'))).messages.length, 0);
    assert.equal((await replaceCards(card('ABC123','live'))).status, 'PARTIAL_LAYOUT');
    assert.equal((await replaceCards(Array.from({length:30}, (_, i) =>
      card('ABC123', String(i))).join(''))).messages.length, 25);
  } finally { await browser.close(); }
});

test('private dry-run renders the synthetic shell and reports counts without acceptance or content', async () => {
  const result = await acquire('dry-run', 'abc123');
  assert.equal(result.status, 'COMPLETE');
  assert.equal(result.inspected, 1);
  assert.equal(result.accepted, 0);
  assert.equal(result.coverage, 'UNKNOWN');
  assert.doesNotMatch(JSON.stringify(result), /Synthetic private preview|\/messages\//);
  assert.equal((await acquire('dry-run', '123456')).inspected, 0);
  await assert.rejects(acquire('dry-run', '*'), /scope/);
});

for (const acrossSamples of [false, true]) {
  for (const changedValue of [false, true]) {
    test(`reordered displayed duplicates ${acrossSamples ? 'across samples' : 'within a sample'} ${changedValue ? 'reject changed facts' : 'preserve identical facts'}`, async () => {
      const { validateWindow } = await import('../../packages/backend/src/modules/source-connectors/infrastructure/airframes/page-window.ts');
      const browser = await chromium.launch({ chromiumSandbox: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium-headless-shell' });
      try {
        const page = await browser.newPage();
        const fields = '<dt>Registration</dt><dd>N-TEST</dd><dt>Callsign</dt><dd>TEST123</dd>';
        const reordered = `<dt>Callsign</dt><dd>${changedValue ? 'TEST456' : 'TEST123'}</dd><dt>Registration</dt><dd>N-TEST</dd>`;
        const card = evidence => `<div class="vue-recycle-scroller__item-view"><div class="mb-4 border">
          <a href="/airframes/synthetic">ABC123</a><a href="/messages/synthetic-duplicate">Details</a>
          <div class="bg-inner">Synthetic duplicate</div><dl>${evidence}</dl></div></div>`;
        await page.route(liveUrl, route => route.fulfill({ contentType: 'text/html', body: `
          <div class="messages-scroller">${card(fields)}${acrossSamples ? '' : card(reordered)}</div>
          <script>
            window.sampleCount = 0;
            const scroller = document.querySelector('.messages-scroller');
            const query = scroller.querySelectorAll.bind(scroller);
            scroller.querySelectorAll = selector => {
              window.sampleCount++;
              return query(selector);
            };
          </script>` }));
        const observation = observePage(page, 'ABC123', acrossSamples ? 1500 : 0);
        if (acrossSamples) {
          // A separate browser task runs only after the first synchronous card read.
          await page.waitForFunction(() => window.sampleCount >= 1, null, { polling: 10 });
          await page.evaluate(value => { document.querySelector('dl').innerHTML = value; }, reordered);
        }
        const result = await observation;
        const sampleCount = await page.evaluate(() => window.sampleCount);
        assert.ok(acrossSamples ? sampleCount >= 2 : sampleCount === 1);
        assert.equal(result.status, changedValue ? 'PARTIAL_LAYOUT' : 'OBSERVED');
        assert.equal(result.messages.length, 1);
        assert.deepEqual(result.messages[0].evidence, { registration: 'N-TEST', callsign: 'TEST123' });
        const validated = validateWindow(result, 'ABC123', 1);
        if (changedValue) assert.equal(validated, 'INVALID_ENVELOPE');
        else assert.equal(validated.length, 1);
      } finally { await browser.close(); }
    });
  }
}

test('leaving the live path between samples discards the window before reading off-scope cards', async () => {
  const browser = await chromium.launch({ chromiumSandbox: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium-headless-shell' });
  try {
    const page = await browser.newPage();
    await page.route(liveUrl, route => route.fulfill({ contentType: 'text/html', body: `
      <div class="messages-scroller"><div class="vue-recycle-scroller__item-view"><div class="mb-4 border">
        <a href="/airframes/fixture">ABC123</a><a href="/messages/one">Details</a>
        <div class="bg-inner">Synthetic message</div></div></div></div>
      <script>
        const scroller = document.querySelector('.messages-scroller');
        const query = scroller.querySelectorAll.bind(scroller);
        window.samplePaths = [];
        scroller.querySelectorAll = selector => {
          samplePaths.push(location.pathname);
          queueMicrotask(() => history.pushState(null, '', '/messages/history'));
          return query(selector);
        };
      </script>` }));
    const result = await observePage(page, 'ABC123', 1500);
    assert.deepEqual(result, { status: 'HTTP_FAILURE', httpStatus: 403 });
    assert.deepEqual(await page.evaluate(() => window.samplePaths), ['/messages/live']);
  } finally { await browser.close(); }
});

test('synthetic displayed fields normalize end to end; empty and incompatible layouts differ', async () => {
  const { normalizeRenderedDelivery } = await import('../../packages/backend/src/modules/source-connectors/infrastructure/airframes/normalize-rendered-delivery.ts');
  const { validateWindow } = await import('../../packages/backend/src/modules/source-connectors/infrastructure/airframes/page-window.ts');
  const browser = await chromium.launch({ chromiumSandbox: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium-headless-shell' });
  try {
    const page = await browser.newPage();
    const card = `<div class="vue-recycle-scroller__item-view"><div class="mb-4 border">
      <a href="/airframes/synthetic">ABC123</a><a href="/messages/synthetic-record">Details</a>
      <a href="/stations/synthetic">Synthetic feeder</a><div class="bg-inner">Synthetic only</div>
      <dl><dt>Registration</dt><dd>N-TEST</dd><dt>Callsign</dt><dd>TEST123</dd>
      <dt>Reception time</dt><dd><time datetime="2026-11-19T10:00:00Z">10:00 UTC</time></dd>
      <dt>Time uncertainty (ms)</dt><dd>500</dd><dt>Direction</dt><dd>UPLINK</dd>
      <dt>Bearer</dt><dd>VDL2</dd></dl></div></div>`;
    let html = card;
    await page.route(liveUrl, route => route.fulfill({ contentType: 'text/html',
      body: `<div class="messages-scroller">${html}</div>` }));
    const result = await observePage(page, 'ABC123', 0);
    assert.equal(result.status, 'OBSERVED');
    const deliveries = validateWindow(result, 'ABC123', Date.parse('2026-11-19T10:01:00Z'));
    assert.equal(deliveries.length, 1);
    const normalized = normalizeRenderedDelivery(deliveries[0], {
      sourceId: 'src_synthetic', provider: 'airframes', accountScope: 'synthetic', sourceEpoch: 'v1',
      ingestedAt: { at: '2026-11-19T10:01:00Z', basis: 'INGESTED', precision: 'SECOND', uncertaintyMs: 500 },
    }, { revision: 1, supportedDataLevels: ['PROVIDER_MESSAGE'], coverage: { kind: 'UNKNOWN' },
      receiverCoverageCompleteness: 'UNKNOWN', sampling: { kind: 'NOT_DECLARED' },
      messageDirection: 'UNKNOWN', bearer: null, protocolStack: [] });
    assert.equal(normalized.ok, true, JSON.stringify(normalized));
    assert.equal(normalized.value.observation.dataLevel, 'PROVIDER_MESSAGE');
    assert.equal(normalized.value.aircraftHints.registration, 'N-TEST');
    assert.equal(normalized.value.aircraftRole, 'ADDRESSEE');
    assert.equal(normalized.value.provenance.feeder, 'Synthetic feeder');
    assert.equal(normalized.value.observation.protocolStack, undefined);
    html = '';
    assert.equal((await observePage(page, 'ABC123', 0)).status, 'NO_OBSERVATIONS_COVERAGE_UNKNOWN');
    html = '<div class="vue-recycle-scroller__item-wrapper"></div>';
    assert.equal((await observePage(page, 'ABC123', 0)).status, 'NO_OBSERVATIONS_COVERAGE_UNKNOWN');
    html = '<div>' + card + '</div><div class="vue-recycle-scroller__resize-observer"></div>';
    assert.equal((await observePage(page, 'ABC123', 0)).status, 'OBSERVED');
    html = '<div>' + card + '<article>Incompatible sibling</article></div>';
    assert.equal((await observePage(page, 'ABC123', 0)).status, 'PARTIAL_LAYOUT');
    html = '<article>Incompatible fabricated layout</article>';
    assert.equal((await observePage(page, 'ABC123', 0)).status, 'PARTIAL_LAYOUT');
    for (const incompatible of ['Incompatible text-only layout',
      '<article>Incompatible fabricated record</article>',
      '<div class="vue-recycle-scroller__item-view"><article>Changed card</article></div>']) {
      for (const prefix of ['', card]) {
        html = prefix + incompatible;
        const partial = await observePage(page, 'ABC123', 0);
        assert.equal(partial.status, 'PARTIAL_LAYOUT', html);
        assert.equal(partial.messages.length, prefix ? 1 : 0);
        assert.equal(validateWindow(partial, 'ABC123', 1), 'INVALID_ENVELOPE');
      }
    }
    html = '<div role="status">No messages</div>';
    assert.equal((await observePage(page, 'ABC123', 0)).status, 'NO_OBSERVATIONS_COVERAGE_UNKNOWN');
    html += '<article>Incompatible fabricated record</article>';
    assert.equal((await observePage(page, 'ABC123', 0)).status, 'PARTIAL_LAYOUT');
    html = `<div class="vue-recycle-scroller__item-wrapper">${card}</div>`;
    assert.equal((await observePage(page, 'ABC123', 0)).status, 'OBSERVED');
    html = card.replace('ABC123', 'no aircraft address');
    assert.equal((await observePage(page, 'ABC123', 0)).status, 'PARTIAL_LAYOUT');
    html = card.replace('<dt>Registration</dt>', '<dt>Registration</dt><dd>N-OTHER</dd><dt>Registration</dt>');
    assert.equal((await observePage(page, 'ABC123', 0)).status, 'PARTIAL_LAYOUT');
    html = card.replace(/<dl>[\s\S]*?<\/dl>/, '');
    const optional = await observePage(page, 'ABC123', 0);
    assert.equal(optional.status, 'OBSERVED');
    assert.equal(optional.messages[0].evidence, undefined);
  } finally { await browser.close(); }
});

for (const [name, extra, status] of [
  ['distinct message links', '<a href="/messages/second">Second</a>', 'PARTIAL_LAYOUT'],
  ['distinct bodies', '<div class="bg-inner">Second synthetic body</div>', 'PARTIAL_LAYOUT'],
  ['identical bodies', '<div class="bg-inner">Synthetic body</div>', 'PARTIAL_LAYOUT'],
  ['duplicate links to the same message', '<a href="/messages/first">Same record</a>', 'OBSERVED'],
]) {
  test(`rendered card cardinality handles ${name}`, async () => {
    const { validateWindow } = await import('../../packages/backend/src/modules/source-connectors/infrastructure/airframes/page-window.ts');
    const browser = await chromium.launch({ chromiumSandbox: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium-headless-shell' });
    try {
      const page = await browser.newPage();
      await page.route(liveUrl, route => route.fulfill({ contentType: 'text/html', body: `
        <div class="messages-scroller"><div class="vue-recycle-scroller__item-view"><div class="mb-4 border">
          <a href="/airframes/synthetic">ABC123</a><a href="/messages/first">First</a>
          <div class="bg-inner">Synthetic body</div>${extra}</div></div></div>` }));
      const result = await observePage(page, 'ABC123', 0);
      assert.equal(result.status, status);
      assert.equal(result.messages.length, status === 'OBSERVED' ? 1 : 0);
      const validated = validateWindow(result, 'ABC123', 1);
      if (status === 'PARTIAL_LAYOUT') assert.equal(validated, 'INVALID_ENVELOPE');
      else assert.equal(validated.length, 1);
    } finally { await browser.close(); }
  });
}
