import { useEffect } from 'react';
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import type { components } from '../../shared/api/generated';

export type ObservedTrackLayerProps = { map: MapLibreMap | null; track: components['schemas']['Track'] | null };
const sourceId = 'terminal-velocity-observed-track';
const layerId = 'terminal-velocity-observed-track-line';
const pointLayerId = 'terminal-velocity-observed-track-points';

/** Draws actual API segments as separate GeoJSON features, preserving gaps. */
export function ObservedTrackLayer({ map, track }: ObservedTrackLayerProps) {
  useEffect(() => {
    if (!map) return;
    const features: GeoJSON.Feature<GeoJSON.Geometry>[] = [];
    for (const segment of track?.segments ?? []) {
      const coordinates = segment.map((position) => [position.longitude, position.latitude] as [number, number]);
      if (coordinates.length >= 2) features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } });
      else if (coordinates.length === 1) features.push({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: coordinates[0] } });
    }
    const update = () => {
      if (!map.isStyleLoaded()) return;
      const source = map.getSource(sourceId) as GeoJSONSource | undefined;
      if (!features.length) {
        if (map.getLayer(layerId)) map.removeLayer(layerId);
        if (map.getLayer(pointLayerId)) map.removeLayer(pointLayerId);
        if (map.getSource(sourceId)) map.removeSource(sourceId);
        return;
      }
      const data: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features };
      if (source) source.setData(data);
      else {
        map.addSource(sourceId, { type: 'geojson', data });
      }
      if (features.some((feature) => feature.geometry.type === 'LineString') && !map.getLayer(layerId)) map.addLayer({ id: layerId, type: 'line', source: sourceId, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#c45d2b', 'line-width': 3, 'line-opacity': 0.86 } });
      if (features.some((feature) => feature.geometry.type === 'Point') && !map.getLayer(pointLayerId)) map.addLayer({ id: pointLayerId, type: 'circle', source: sourceId, paint: { 'circle-radius': 4, 'circle-color': '#c45d2b', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.5 } });
    };
    map.on('load', update); map.on('styledata', update);
    update();
    return () => {
      map.off('load', update); map.off('styledata', update);
      try { if (map.getLayer(layerId)) map.removeLayer(layerId); if (map.getLayer(pointLayerId)) map.removeLayer(pointLayerId); if (map.getSource(sourceId)) map.removeSource(sourceId); } catch { /* map may already be disposed */ }
    };
  }, [map, track]);
  return null;
}
