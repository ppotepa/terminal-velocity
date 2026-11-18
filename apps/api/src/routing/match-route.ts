import { URL } from 'node:url';
import { HttpProblem } from '../http/http-problem.ts';
import type { ApiRoute } from './route.ts';

export function matchRoute(target: string): ApiRoute {
  let url: URL;
  try { url = new URL(target, 'http://127.0.0.1'); }
  catch { throw new HttpProblem(400, 'INVALID_URL', 'The request URL is invalid.'); }
  if (url.search !== '') throw new HttpProblem(400, 'UNSUPPORTED_QUERY', 'This demo API does not support query parameters.');
  const path = url.pathname;
  if (path === '/healthz') return { name: 'health', method: 'GET' };
  if (path === '/api/v1/aircraft') return { name: 'aircraft-list', method: 'GET' };
  if (path === '/api/v1/demo/messages') return { name: 'demo-ingest', method: 'POST' };
  const messages = /^\/api\/v1\/aircraft\/([^/]+)\/messages$/.exec(path);
  if (messages?.[1] !== undefined) return { name: 'aircraft-messages', method: 'GET', id: decodeId(messages[1]) };
  const aircraft = /^\/api\/v1\/aircraft\/([^/]+)$/.exec(path);
  if (aircraft?.[1] !== undefined) return { name: 'aircraft', method: 'GET', id: decodeId(aircraft[1]) };
  const message = /^\/api\/v1\/messages\/([^/]+)$/.exec(path);
  if (message?.[1] !== undefined) return { name: 'message', method: 'GET', id: decodeId(message[1]) };
  throw new HttpProblem(404, 'NOT_FOUND', 'The requested endpoint does not exist.');
}

function decodeId(segment: string): string {
  let decoded: string;
  try { decoded = decodeURIComponent(segment); }
  catch { throw new HttpProblem(400, 'INVALID_URL', 'The path contains invalid percent encoding.'); }
  if (decoded.includes('/') || decoded.includes('\\') || /[\u0000-\u001f\u007f]/.test(decoded))
    throw new HttpProblem(400, 'INVALID_URL', 'The path identifier contains an unsupported character.');
  return decoded;
}
