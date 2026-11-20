import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { chromium } from 'playwright-core';

const webRoot = fileURLToPath(new URL('../../', import.meta.url));
const viteBin = fileURLToPath(new URL('../../../../node_modules/vite/bin/vite.js', import.meta.url));

async function startPreview(t) {
  const reservation = createServer().listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const child = spawn(process.execPath, [viteBin, 'preview', '--host', '127.0.0.1',
    '--port', String(port), '--strictPort'], { cwd: webRoot, stdio: ['ignore','pipe','pipe'] });
  let diagnostics = '';
  child.stderr.on('data', chunk => { diagnostics += chunk.toString(); });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await once(child, 'exit');
    }
  });
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Web preview exited: ${diagnostics}`);
    try { if ((await fetch(base)).ok) return base; } catch { /* Starting. */ }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Web preview did not start: ${diagnostics}`);
}

const snapshot = { data: [{ aircraftId: 'ac_demo-001',
  position: { latitude: 52, longitude: 21, observedAt: '2026-11-20T12:00:00.000Z',
    freshness: 'STALE', source: 'DEMO_FIXTURE', measurementKind: 'DEMO' },
  messages: { freshness: 'NONE', lastMessageAt: null,
    coverage: 'UNKNOWN', feedHealth: 'DISCONNECTED' } }],
  nextCursor: null, asOf: '2026-11-20T12:01:00.000Z', checkpoint: 0 };

async function setup(t) {
  const base = await startPreview(t);
  const browser = await chromium.launch({ chromiumSandbox: true,
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium-headless-shell' });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  let fail = false;
  const requests = [];
  await page.route('**/api/v1/internal/map/aircraft?**', async route => {
    const url = new URL(route.request().url());
    requests.push(url);
    if (fail) return route.fulfill({ status: 503, contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'Synthetic API unavailable.' } }) });
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify(url.searchParams.get('positionStatus') === 'CURRENT'
        ? { ...snapshot, data: [] } : snapshot) });
  });
  return { page, base, requests, setFailure(value) { fail = value; } };
}

test('light shell has stable desktop/tablet/mobile layout snapshots and readable typography', async t => {
  const { page, base } = await setup(t);
  await page.goto(base);
  await page.getByText('1 aircraft positions in this viewport').waitFor();
  for (const [width, expected] of [[1440,'three'],[1024,'three'],[768,'two'],[390,'stacked']]) {
    await page.setViewportSize({ width, height: 900 });
    const layout = await page.evaluate(() => {
      const boxes = [...document.querySelectorAll('.tv-layout > .tv-panel')]
        .map(element => { const rect = element.getBoundingClientRect();
          return { x: rect.x, y: rect.y, width: rect.width }; });
      const title = document.querySelector('h1');
      return { boxes, font: getComputedStyle(document.documentElement).fontFamily,
        titleSize: getComputedStyle(title).fontSize,
        scrollWidth: document.documentElement.scrollWidth };
    });
    assert.equal(layout.boxes.length, 3);
    assert.equal(layout.titleSize, '22px');
    assert.match(layout.font, /system-ui/);
    assert.ok(layout.scrollWidth <= width, `horizontal overflow at ${width}px`);
    const [filters, map, details] = layout.boxes;
    if (expected === 'three') {
      assert.ok(filters.x < map.x && map.x < details.x);
      assert.ok(Math.abs(filters.y - map.y) < 2 && Math.abs(map.y - details.y) < 2);
    } else if (expected === 'two') {
      assert.ok(filters.x < map.x && Math.abs(filters.y - map.y) < 2);
      assert.ok(details.y > map.y);
    } else {
      assert.ok(filters.y < map.y && map.y < details.y);
    }
    const png = await page.screenshot();
    assert.equal(png.subarray(1,4).toString(), 'PNG');
    assert.ok(png.byteLength > 8_000);
  }
});

test('keyboard focus, named controls, URL selection and empty/error states work', async t => {
  const { page, base, requests, setFailure } = await setup(t);
  await page.goto(base);
  await page.getByText('1 aircraft positions in this viewport').waitFor();
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Skip to content');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Map');
  const outline = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
  assert.equal(outline, 'solid');
  const position = page.getByRole('combobox', { name: 'Position status' });
  assert.ok(await position.isVisible());
  assert.ok(await page.getByRole('combobox', { name: 'Message status' }).isVisible());
  assert.ok(await page.getByRole('combobox', { name: 'Protocol' }).isVisible());
  await position.selectOption('CURRENT');
  await page.getByText('No positions in this viewport').waitFor();
  assert.equal(new URL(page.url()).searchParams.get('positionStatus'), 'CURRENT');
  assert.equal(requests.at(-1).searchParams.get('positionStatus'), 'CURRENT');
  const input = page.getByRole('textbox', { name: 'Aircraft ID' });
  await input.fill('bad id');
  await page.getByRole('button', { name: 'Select aircraft' }).click();
  assert.equal(await input.getAttribute('aria-invalid'), 'true');
  await input.fill('ac_demo-001');
  await page.getByRole('button', { name: 'Select aircraft' }).click();
  assert.equal(new URL(page.url()).searchParams.get('aircraft'), 'ac_demo-001');
  await page.getByRole('link', { name: 'Flights' }).click();
  await page.getByText('This view is not available yet').waitFor();
  await page.getByRole('link', { name: 'Map' }).click();
  await page.getByText('Selected ac_demo-001').waitFor();
  setFailure(true);
  await position.selectOption('STALE');
  await page.getByRole('alert').getByText('Viewport unavailable').waitFor();
  assert.equal(await page.getByRole('alert').getByText('Synthetic API unavailable.').isVisible(), true);
});
