import type { DemoTracker } from '../public/types.ts';
import { mapViewportQuery, withinMapBounds, type MapAircraft, type MapReader } from '../../modules/map-projection/public/index.ts';

/** The memory demo has three fixed markers; PostgreSQL is the durable map path. */
export function createDemoMapReader(tracker: DemoTracker, now: () => number = Date.now): MapReader {
  return { async read(input) {
    const query = mapViewportQuery(input);
    const asOf = query.cursor?.asOf ?? new Date(now()).toISOString();
    const listed = await tracker.listAircraft();
    if (!listed.ok) throw new Error('The demo fleet is unavailable.');
    const items: MapAircraft[] = [];
    for (const aircraft of listed.value) {
      const positionAge = Date.parse(asOf) - Date.parse(aircraft.position.observedAt);
      const positionFreshness = positionAge < 0 ? 'UNKNOWN' : positionAge < 60_000 ? 'CURRENT' : 'STALE';
      if (!withinMapBounds(aircraft.position.latitude, aircraft.position.longitude, query.bbox)) continue;
      if (query.positionStatus && query.positionStatus !== positionFreshness) continue;
      let lastMessageAt = aircraft.availability.lastMessageAt;
      let freshness = aircraft.availability.freshness;
      if (query.protocol) {
        const found = await tracker.getMessages(aircraft.aircraftId);
        if (!found.ok) throw new Error('The demo messages are unavailable.');
        const matches = found.value.filter(message => message.bearer === query.protocol);
        if (matches.length === 0) continue;
        lastMessageAt = matches.reduce((latest, message) =>
          latest === null || message.observedAt > latest ? message.observedAt : latest, null as string | null);
        const age = Date.parse(asOf) - Date.parse(lastMessageAt!);
        freshness = age < 0 || age >= 3_600_000 ? 'NONE' : age < 600_000 ? 'RECENT' : 'STALE';
      }
      if (query.messageStatus && query.messageStatus !== freshness) continue;
      items.push({ aircraftId: aircraft.aircraftId,
        position: { latitude: aircraft.position.latitude, longitude: aircraft.position.longitude,
          observedAt: aircraft.position.observedAt, freshness: positionFreshness,
          source: 'DEMO_FIXTURE', measurementKind: 'DEMO' },
        messages: { freshness, lastMessageAt, coverage: aircraft.availability.coverage,
          feedHealth: aircraft.availability.feedHealth } });
    }
    items.sort((a, b) => a.aircraftId < b.aircraftId ? -1 : a.aircraftId > b.aircraftId ? 1 : 0);
    const remaining = items.filter(item => item.aircraftId > (query.cursor?.after ?? ''));
    const data = remaining.slice(0, query.limit);
    return { data, asOf, checkpoint: 0,
      nextCursor: remaining.length > query.limit && data.length > 0
        ? { revision: 0, after: data[data.length-1]!.aircraftId, asOf, queryKey: query.queryKey }
        : null };
  } };
}
