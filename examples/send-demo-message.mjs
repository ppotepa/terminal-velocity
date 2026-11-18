const port = process.env.PORT ?? '3000';
if (!/^[1-9][0-9]{0,4}$/.test(port) || Number(port) > 65535) {
  throw new Error('PORT must be a decimal integer from 1 to 65535.');
}
const base = `http://127.0.0.1:${port}`;

async function request(path, options) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    signal: AbortSignal.timeout(5000),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${JSON.stringify(payload)}`);
  return payload.data;
}

const aircraft = (await request('/api/v1/aircraft'))[0];
if (!aircraft) throw new Error('The demo aircraft catalog is empty.');
const message = {
  messageId: `msg_demo-${Date.now()}`,
  observedAt: new Date().toISOString(),
  bearer: 'VDL2',
  text: 'Syntetyczna wiadomość demonstracyjna',
  icao24: aircraft.icao24,
};
const options = {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(message),
};
console.log('Created:', await request('/api/v1/demo/messages', options));
console.log('Replay:', await request('/api/v1/demo/messages', options));
console.log('Aircraft:', await request(`/api/v1/aircraft/${aircraft.aircraftId}`));
