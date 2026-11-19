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
  } finally { await browser.close(); }
});
