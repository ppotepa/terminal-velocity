import { Buffer } from 'node:buffer';
import type { ServerResponse } from 'node:http';

/** Serialize before sending headers so a serialization failure remains recoverable. */
export function sendJson(response: ServerResponse, status: number, body: unknown,
  headers: Readonly<Record<string, string>> = {}): void {
  const json = JSON.stringify(body);
  if (json === undefined) throw new Error('Response body is not JSON serializable');
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(json),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  response.end(json);
}
