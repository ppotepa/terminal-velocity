import { Map as LibreMap, Marker, type GeoJSONSource } from 'maplibre-gl';
import type { MapAircraft } from '../../shared/api/map-snapshot.ts';
import { markerStatus, uniqueAircraft } from './markers.ts';
import { trackGeoJson, type TrackPage } from './observed-track.ts';
import { boundedBbox } from './viewport-bounds.ts';

const sourceId = 'observed-track';
const layerId = 'observed-track-line';
const blankStyle = { version: 8 as const, sources: {}, layers: [
  { id: 'background', type: 'background' as const, paint: { 'background-color': '#e8eff2' } },
] };

export function configuredStyle(): string | typeof blankStyle {
  const value = import.meta.env.VITE_MAP_STYLE_URL?.trim();
  if (!value) return blankStyle;
  if (value.startsWith('/') && !value.startsWith('//')) return value;
  if (/^https:\/\//.test(value)) return value;
  throw new TypeError('Map style URL must be HTTPS or a same-origin path.');
}

export class MapLayerAdapter {
  readonly map: LibreMap;
  private markers = new Map<string, { marker: Marker; element: HTMLButtonElement }>();
  private aircraft: readonly MapAircraft[] = [];
  private selected = '';
  private track: TrackPage | null = null;
  private select: (id: string) => void = () => {};

  constructor(element: HTMLElement, onBounds: (bbox: string, zoom: number) => void,
    onError: (message: string) => void) {
    this.map = new LibreMap({ container: element, style: configuredStyle(),
      center: [19, 52], zoom: 5, maxZoom: 18, attributionControl: {} });
    this.map.on('style.load', () => this.applyTrack());
    this.map.on('load', () => this.reportBounds(onBounds));
    this.map.on('moveend', () => this.reportBounds(onBounds));
    this.map.on('error', () => onError('Map style or tiles could not load. Aircraft remain available in the list.'));
  }

  private reportBounds(onBounds: (bbox: string, zoom: number) => void) {
    const bounds = this.map.getBounds();
    try { onBounds(boundedBbox(bounds.getWest(), bounds.getSouth(),
      bounds.getEast(), bounds.getNorth()), this.map.getZoom()); }
    catch { /* Keep the last valid viewport while a map projection is transitioning. */ }
  }

  setAircraft(items: readonly MapAircraft[], selected: string, onSelect: (id: string) => void) {
    this.aircraft = uniqueAircraft(items);
    this.selected = selected;
    this.select = onSelect;
    const ids = new Set(this.aircraft.map(item => item.aircraftId));
    for (const [id, entry] of this.markers) {
      if (!ids.has(id)) { entry.marker.remove(); this.markers.delete(id); }
    }
    for (const item of this.aircraft) {
      let entry = this.markers.get(item.aircraftId);
      if (!entry) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'tv-aircraft-marker';
        button.dataset.aircraftId = item.aircraftId;
        button.addEventListener('click', () => this.select(item.aircraftId));
        const marker = new Marker({ element: button, anchor: 'center' })
          .setLngLat([item.position.longitude, item.position.latitude]).addTo(this.map);
        entry = { marker, element: button };
        this.markers.set(item.aircraftId, entry);
      }
      entry.marker.setLngLat([item.position.longitude, item.position.latitude]);
      const status = markerStatus(item);
      entry.element.style.setProperty('--marker-color', status.color);
      entry.element.setAttribute('aria-label', `${item.aircraftId}, ${status.label}, position ${item.position.freshness.toLowerCase()}, feed disconnected`);
      entry.element.setAttribute('aria-pressed', String(item.aircraftId === selected));
      entry.element.title = `${item.aircraftId} · ${status.label}`;
      entry.element.textContent = item.position.headingDegrees === undefined ? '●' : '▲';
      entry.element.style.setProperty('--marker-heading', `${item.position.headingDegrees ?? 0}deg`);
    }
  }

  setTrack(page: TrackPage | null) { this.track = page; this.applyTrack(); }

  private applyTrack() {
    if (!this.map.isStyleLoaded()) return;
    let source = this.map.getSource<GeoJSONSource>(sourceId);
    if (!source) {
      this.map.addSource(sourceId, { type: 'geojson', data: trackGeoJson(this.track) });
      this.map.addLayer({ id: layerId, type: 'line', source: sourceId,
        paint: { 'line-color': '#244b91', 'line-width': 3, 'line-opacity': 0.85 } });
      source = this.map.getSource<GeoJSONSource>(sourceId);
    }
    source?.setData(trackGeoJson(this.track));
  }

  destroy() { for (const entry of this.markers.values()) entry.marker.remove(); this.markers.clear(); this.map.remove(); }
}
