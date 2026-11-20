# Live map

`LiveMapFeature` reads `/map/snapshot` through the shared typed API client and renders only aircraft returned by the backend. Aircraft without coordinates stay in the keyboard-navigable list and never receive placeholder coordinates. Refresh polls the bounded snapshot every 20 seconds; selection is reported through `onSelectAircraft`.

The default MapLibre style URL is OpenFreeMap Liberty. Override it with `VITE_MAP_STYLE_URL` for a permitted compatible style. The map retains the aircraft list if style or tile loading fails and falls back to a neutral surface. MapLibre's attribution control remains enabled.
