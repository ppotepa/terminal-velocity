import type { ApiResult } from '@airframes/backend/demo';
import type { ServerResponse } from 'node:http';
import { apiErrorStatus } from './api-error-status.ts';
import { sendJson } from './send-json.ts';

export const internalErrorBody = {
  error: { code: 'INTERNAL_ERROR', message: 'An internal error occurred.' },
} as const;

export function sendApiResult<T>(response: ServerResponse, result: ApiResult<T>, successStatus = 200): void {
  if (result.ok) {
    sendJson(response, successStatus, { data: result.value });
    return;
  }
  const status = apiErrorStatus(result.error.code);
  sendJson(response, status, status === 500 ? internalErrorBody : { error: result.error });
}
