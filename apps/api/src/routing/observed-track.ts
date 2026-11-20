import { observedTrackQuery, type ObservedTrackQuery } from '@airframes/backend/flight-tracking';
import { HttpProblem } from '../http/http-problem.ts';

export function parseObservedTrack(aircraftId: string, search: string): ObservedTrackQuery {
  const params = new URLSearchParams(search);
  const allowed = new Set(['from', 'to', 'zoom']);
  for (const key of params.keys()) {
    if (!allowed.has(key) || params.getAll(key).length !== 1)
      throw new HttpProblem(400, 'INVALID_TRACK_QUERY', 'Unsupported or repeated track query parameter.');
  }
  const from = params.get('from'), to = params.get('to'), zoom = params.get('zoom') ?? '5';
  if (!from || !to || !/^\d{1,15}$/.test(from) || !/^\d{1,15}$/.test(to)
    || !/^(?:\d{1,2})(?:\.\d{1,2})?$/.test(zoom))
    throw new HttpProblem(400, 'INVALID_TRACK_QUERY', 'A bounded time window and zoom are required.');
  const parsed = observedTrackQuery({ aircraftId, fromObservedAtMs: Number(from),
    toObservedAtMs: Number(to), zoom: Number(zoom), limit: 500, pointBudget: 500 });
  if (!parsed.ok) throw new HttpProblem(400, 'INVALID_TRACK_QUERY', `Invalid track ${parsed.error.field}.`);
  return parsed.value;
}
