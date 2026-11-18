import type { ApiErrorCode } from '@airframes/backend/demo';

const statuses: Readonly<Record<ApiErrorCode, number>> = {
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  MESSAGE_CONFLICT: 409,
  CAPACITY_EXCEEDED: 429,
  CANDIDATE_SET_INCOMPLETE: 503,
  INTERNAL_ERROR: 500,
};

export function apiErrorStatus(code: ApiErrorCode): number {
  return statuses[code] ?? 500;
}
