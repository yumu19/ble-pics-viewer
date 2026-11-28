import { SIGNAL_LABELS } from './pics.mjs';

const markerStyles = {
  location: { color: '#52695b', radius: 4 },
  receiving: { color: '#17775b', radius: 8 },
  selected: { color: '#a05b12', radius: 11 },
};

export function haversineMeters(lat1, lng1, lat2, lng2) {
  const radians = degrees => degrees * Math.PI / 180;
  const a = Math.sin(radians(lat2 - lat1) / 2) ** 2
    + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(radians(lng2 - lng1) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(Math.min(1, a)));
}

export function nearestLocation(locations, lat, lng) {
  let nearest = null;
  for (const location of locations) {
    const distanceMeters = haversineMeters(lat, lng, location.lat, location.lng);
    if (!nearest || distanceMeters < nearest.distanceMeters) nearest = { location, distanceMeters };
  }
  return nearest;
}

export function sortByDistance(locations, lat, lng) {
  return locations.map(location => ({
    location,
    distanceMeters: haversineMeters(lat, lng, location.lat, location.lng),
  })).sort((a, b) => a.distanceMeters - b.distanceMeters);
}

function popupContent(name, ...details) {
  const popup = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = name;
  popup.append(title);
  for (const detail of details) {
    const description = document.createElement('div');
    description.textContent = detail;
    popup.append(description);
  }
  return popup;
}

function formatDistance(meters) {
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
}

export function createMapView({ mapElement, listElement, onSelectLocation }) {
  const L = window.L;
  if (!L) {
    mapElement.textContent = '地図を読み込めませんでした。';
    const noop = () => {};
    return { setLocations: noop, setUserPosition: noop, updateReceived: noop, focusLocation: noop };
  }

  const map = L.map(mapElement, { scrollWheelZoom: false }).setView([36.5, 138], 5);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
  }).addTo(map);

  const datasetLayers = L.layerGroup().addTo(map);
  const datasetMarkers = new Map();
  const standaloneMarkers = new Map();
  let highlighted = new Map();
  let locations = [];
  let userMarker;

  function refreshNearby() {
    const { lat, lng } = userMarker.getLatLng();
    const sorted = sortByDistance(locations, lat, lng);
    const nearby = sorted.filter(({ distanceMeters }) => distanceMeters <= 5000);
    const items = (nearby.length ? nearby : sorted).slice(0, 10).map(({ location, distanceMeters }) => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = `${location.name} · ${formatDistance(distanceMeters)}`;
      button.addEventListener('click', () => {
        onSelectLocation(location);
        map.panTo([location.lat, location.lng]);
      });
      item.append(button);
      return item;
    });
    listElement.replaceChildren(...items);
  }

  function setLocations(entries) {
    locations = entries;
    datasetLayers.clearLayers();
    datasetMarkers.clear();
    highlighted.clear();
    for (const location of locations) {
      const marker = L.circleMarker([location.lat, location.lng], markerStyles.location)
        .bindPopup(popupContent(location.name, location.address)).addTo(datasetLayers);
      datasetMarkers.set(location, marker);
    }
    if (userMarker) refreshNearby();
  }

  function setUserPosition(lat, lng) {
    if (userMarker) {
      userMarker.setLatLng([lat, lng]);
    } else {
      userMarker = L.circleMarker([lat, lng], {
        color: '#2167a2', fillOpacity: 0.65, radius: 7,
      }).bindPopup('現在地').addTo(map);
    }
    refreshNearby();
  }

  function updateReceived(intersections, selectedId) {
    const nextHighlights = new Map();
    const activeStandalone = new Set();
    for (const [id, entry] of intersections) {
      const { latitude, longitude } = entry;
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
      const nearest = nearestLocation(locations, latitude, longitude);
      const location = nearest?.distanceMeters <= 150 ? nearest.location : null;
      const selected = id === selectedId;
      const style = selected ? markerStyles.selected : markerStyles.receiving;
      const name = location?.name || entry.identifier || `交差点 ${id}`;
      if (location && nextHighlights.get(location)?.selected) continue;

      const signals = [0, 1].map(index => {
        const state = entry.pedestrian_signals?.[index]?.signal_state;
        return `信号${index + 1}：${SIGNAL_LABELS[state] ?? '未受信'}`;
      }).join(' / ');
      if (location) {
        nextHighlights.set(location, { selected, style, signals });
      } else {
        activeStandalone.add(id);
        let marker = standaloneMarkers.get(id);
        if (!marker) {
          marker = L.circleMarker([latitude, longitude], style)
            .bindPopup(popupContent(name, signals)).addTo(map);
          standaloneMarkers.set(id, marker);
        } else {
          marker.setLatLng([latitude, longitude]).setStyle(style)
            .setPopupContent(popupContent(name, signals));
        }
        if (selected) marker.bringToFront();
      }
    }

    for (const [location, { selected, style, signals }] of nextHighlights) {
      const previous = highlighted.get(location);
      if (previous?.selected === selected && previous.signals === signals) continue;
      const marker = datasetMarkers.get(location);
      marker.setStyle(style).setPopupContent(popupContent(location.name, location.address, signals));
      marker.bringToFront();
    }
    for (const location of highlighted.keys()) {
      if (nextHighlights.has(location)) continue;
      datasetMarkers.get(location).setStyle(markerStyles.location)
        .setPopupContent(popupContent(location.name, location.address));
    }
    highlighted = nextHighlights;
    for (const [id, marker] of standaloneMarkers) {
      if (activeStandalone.has(id)) continue;
      marker.remove();
      standaloneMarkers.delete(id);
    }
  }

  function focusLocation(lat, lng) {
    if (map.getZoom() < 16) map.setView([lat, lng], 16);
    else map.panTo([lat, lng]);
  }

  return { setLocations, setUserPosition, updateReceived, focusLocation };
}
