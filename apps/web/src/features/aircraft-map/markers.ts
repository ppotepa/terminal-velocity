import type { MapAircraft } from '../../shared/api/map-snapshot.ts';

export function uniqueAircraft(items: readonly MapAircraft[]): readonly MapAircraft[] {
  return [...new Map(items.map(item => [item.aircraftId, item])).values()]
    .sort((a, b) => a.aircraftId.localeCompare(b.aircraftId));
}

export function markerStatus(item: MapAircraft): { label: string; color: string } {
  switch (item.messages.freshness) {
    case 'RECENT': return { label: 'Recent message', color: '#0d7c6e' };
    case 'STALE': return { label: 'Older message', color: '#a46410' };
    case 'NONE': return { label: 'No recent message', color: '#5c6676' };
  }
}
