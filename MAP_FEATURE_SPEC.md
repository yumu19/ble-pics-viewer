# Map feature spec — ble-pics-viewer web app

Extend the Web Bluetooth PICS viewer in `web/`. First read `web/README.md`, `web/app.mjs`,
`web/pics.mjs`, `web/index.html`, `web/styles.css` and match the existing style:
plain ES modules, no build step, Japanese UI text, and never use innerHTML with
received/untrusted values (use textContent / DOM APIs).

## Goal

Add a map panel that shows:
- all nationwide advanced-PICS intersections from `web/pics-locations.json`
  (already generated: array of {name, yomi, pref, city, address, lat, lng}, 596 entries;
  source: National Police Agency open data, CC-BY),
- the user's current position (Geolocation API),
- live highlighting of intersections currently being received over BLE
  (received entries already carry latitude/longitude from Type 1 packets).

## Implement

### 1. New module `web/map.mjs`

Export:
- `haversineMeters(lat1, lng1, lat2, lng2)` — pure function.
- `nearestLocation(locations, lat, lng)` — pure; returns `{ location, distanceMeters }`
  for the closest entry, or `null` for empty input.
- `sortByDistance(locations, lat, lng)` — pure; returns a new array of
  `{ location, distanceMeters }` sorted ascending.
- `createMapView({ mapElement, listElement, onSelectLocation })` — builds a Leaflet map
  when `window.L` is available; when Leaflet is missing, put a short fallback message in
  mapElement and make every method a safe no-op. Methods:
  - `setLocations(locations)`: render all dataset intersections as small circleMarkers.
    Popup shows name and address, built with DOM APIs / textContent.
  - `setUserPosition(lat, lng)`: show/move a user-position marker and refresh the nearby
    list in listElement: nearest 10 entries (prefer within 5 km; if none, nearest 10
    overall), each a button labelled `name · distance` (m or km, sensible rounding).
    Clicking an item calls `onSelectLocation(location)` and pans the map to it.
  - `updateReceived(intersections, selectedId)`: `intersections` is the app's Map of
    received entries; values may carry `latitude`, `longitude`, `identifier`,
    `pedestrian_signals`, `signalTimestamp`. For each received entry with coordinates:
    if `nearestLocation` finds a dataset location within 150 m, restyle that marker as
    "receiving" (accent color, larger radius); otherwise add/update a standalone
    received marker at the entry's coordinates. The entry whose key equals `selectedId`
    gets a distinct "selected" style. A receiving marker's popup shows the intersection
    name plus signal 1 / signal 2 states using `SIGNAL_LABELS` from `./pics.mjs`.
    Entries that disappear from the Map lose their highlight / standalone marker.
  - `focusLocation(lat, lng)`: pan (and if needed zoom to at least 16) to the point.
- Keep all Leaflet usage inside map.mjs. Pure helpers must not touch window/document at
  import time (tests import this module in Node).

### 2. `web/index.html`

- Add Leaflet 1.9.4 CSS and JS from the unpkg CDN in `<head>` (CSS with the other
  stylesheet, JS before the app module script; module scripts are deferred, so
  `window.L` will be set).
- Add a new panel section after the monitor section: eyebrow `PICS MAP`, heading
  `周辺の高度化PICS交差点`, `<div id="map">`, a button `#locate` labelled
  `現在地を表示`, `<ol id="nearby-list">`, and captions:
  - data attribution: `出典：警察庁「高度化PICS整備交差点」（CC-BY）をもとに作成`
  - map data: `© OpenStreetMap contributors`
  - a note that a received intersection is highlighted on the map.
- Bump the app.mjs script version query to `?v=20261121-1`.

### 3. `web/app.mjs`

- Import `createMapView` from `./map.mjs?v=20261121-1`.
- Fetch `./pics-locations.json` relative to the page; when it resolves, create the map
  view with the loaded locations. On fetch failure, create it with an empty array so
  received markers still work. Keep a module-level `mapView` reference (null until ready).
- At the end of `render()`, call `mapView?.updateReceived(intersections, selectedId)`.
- `#locate` click: `navigator.geolocation.getCurrentPosition` → on success call
  `mapView.setUserPosition(lat, lng)` and `mapView.focusLocation(lat, lng)`; on error or
  when geolocation is unavailable, show a short Japanese message in the nearby list.
- In the intersection `<select>` change handler, if the newly selected entry has
  coordinates, call `mapView?.focusLocation(entry.latitude, entry.longitude)`.
- `onSelectLocation` callback: focus the map only (dataset locations are separate from
  received intersections).

### 4. `web/styles.css`

- `#map { height: 320px; }` plus panel-consistent styling for the nearby list and the
  locate button area. Keep additions compact and consistent with the existing design.

### 5. Tests — `web/tests/map.test.mjs`

Using `node:test`, cover:
- `haversineMeters`: identical points → 0; Tokyo Station (35.681236, 139.767125) to
  Sapporo Station (43.06866, 141.350755) ≈ 831 km (±10 km).
- `nearestLocation`: picks the closest of a few points; returns null for [].
- `sortByDistance`: ascending order, does not mutate the input.

## Constraints

- Do not change the parsing behavior of `pics.mjs`, and do not modify `bluetooth.mjs`
  or `debug.mjs`.
- Follow the existing cache-busting convention for changed module imports in app.mjs
  (`?v=20261121-1`); the pics.mjs import stays unchanged.
- Run `node --test web/tests/*.test.mjs` — all tests (existing and new) must pass.
