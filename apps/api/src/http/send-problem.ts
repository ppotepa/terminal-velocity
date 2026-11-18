import type { ServerResponse } from 'node:http';
import { HttpProblem } from './http-problem.ts';
import { internalErrorBody } from './send-api-result.ts';
import { sendJson } from './send-json.ts';

export function sendProblem(response: ServerResponse, error: unknown): void {
  if (response.destroyed || response.writableEnded) return;
  if (response.headersSent) {
    response.destroy();
    return;
  }
  if (error instanceof HttpProblem) {
    sendJson(response, error.status, { error: { code: error.code, message: error.message } }, error.headers);
    return;
  }
  sendJson(response, 500, internalErrorBody);
}
