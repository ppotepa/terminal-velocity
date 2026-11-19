// Child process of the loopback browser tests. Keep the CLI's signal handlers
// and exit status intact, then report browser observations to the test parent.
import { chromium } from 'playwright-core';

import { liveUrl } from './airframes-live.mjs';

const [port, pin] = process.argv.slice(2);
if (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535 || !/^[A-Za-z0-9+/]{43}=$/.test(pin))
  throw new Error('A loopback port and an ephemeral certificate pin are required');
const hosts = ['app', 'api', 'ws'].map(name => `MAP ${name}.airframes.io 127.0.0.1:${port}`);
const args = ['--no-proxy-server', '--ignore-certificate-errors-spki-list=' + pin,
  '--host-resolver-rules=' + [...hosts, 'MAP * ~NOTFOUND'].join(', ')];
const requested = [], blocked = [];
const documentResponses = [], pageLogs = [], browsers = [];
const launch = chromium.launch.bind(chromium);
chromium.launch = async options => {
  const browser = await launch({ ...options, args });
  browsers.push(browser);
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async config => {
    const context = await newContext(config);
    await context.grantPermissions(['local-network-access'], { origin: new URL(liveUrl).origin });
    const newSession = context.newCDPSession.bind(context);
    context.newCDPSession = async page => {
      const session = await newSession(page);
      const urls = new Map();
      page.on('console', message => { if (message.text() === 'frame-src') pageLogs.push('frame-src'); });
      session.on('Fetch.requestPaused', event => {
        urls.set(event.requestId, event.request.url);
        if (event.resourceType === 'Document' && event.responseStatusCode)
          documentResponses.push([event.responseStatusCode, event.responseStatusText]);
      });
      const send = session.send.bind(session);
      session.send = async (method, params) => {
        if (method === 'Fetch.failRequest') blocked.push(urls.get(params.requestId));
        if (method === 'Fetch.continueRequest') requested.push(urls.get(params.requestId));
        return send(method, params);
      };
      return session;
    };
    return context;
  };
  return browser;
};

process.argv = [process.execPath, 'cli.mjs', 'crawl', 'ABC123'];
await import('./cli.mjs');
console.log(JSON.stringify({ requested, blocked, documentResponses, pageLogs,
  browsersClosed: browsers.length > 0 && browsers.every(browser => !browser.isConnected()) }));
