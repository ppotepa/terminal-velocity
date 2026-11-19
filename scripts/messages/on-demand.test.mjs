import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { liveUrl } from './airframes-live.mjs';

// Exercise the public crawl strategy with the response served locally at the
// normal page URL. The caller supplies only the strategy and selected aircraft.
test('the on-demand crawl command returns messages from its rendered page for the selected aircraft', { timeout: 45000 }, async t => {
  const launch = chromium.launch.bind(chromium);
  const card = (icao, id) => `<div class="vue-recycle-scroller__item-view"><div class="mb-4 border">
    <a href="/airframes/fixture">${icao}</a><a href="/messages/${id}">Details</a>
    <div class="bg-inner">Synthetic payload ${id}</div></div></div>`;
  const html = '<div class="messages-scroller">' + card('ABC123','selected') + card('DEF456','other') + '</div>';
  let visits = 0;
  t.mock.method(chromium, 'launch', async options => {
    const browser = await launch(options);
    const newContext = browser.newContext.bind(browser);
    browser.newContext = async config => {
      const context = await newContext({ ...config, serviceWorkers: 'block' });
      await context.route('**/*', route => {
        if (route.request().url() !== liveUrl || !route.request().isNavigationRequest()) return route.abort();
        visits++;
        return route.fulfill({ contentType: 'text/html', body: html });
      });
      await context.routeWebSocket('**/*', socket => socket.close());
      return context;
    };
    return browser;
  });
  const output = [];
  t.mock.method(console, 'log', value => output.push(value));
  const argv = process.argv;
  const exitCode = process.exitCode;
  try {
    process.argv = [process.execPath, 'cli.mjs', 'crawl', 'ABC123'];
    await import('./cli.mjs');
    assert.equal(process.exitCode ?? 0, 0);
  } finally {
    process.argv = argv;
    process.exitCode = exitCode;
  }
  assert.equal(output.length, 1);
  const result = JSON.parse(output[0]);
  assert.ok(visits > 0, 'the public on-demand crawl must request its configured live page');
  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0].icao, 'ABC123');
  assert.equal(result.messages[0].text, 'Synthetic payload selected');
});
