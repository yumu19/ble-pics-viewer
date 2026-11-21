import assert from 'node:assert/strict';
import test from 'node:test';
import { haversineMeters, nearestLocation, sortByDistance } from '../map.mjs';

const tokyo = { lat: 35.681236, lng: 139.767125 };
const sapporo = { lat: 43.06866, lng: 141.350755 };
const sendai = { lat: 38.2601, lng: 140.882 };
const locations = [sapporo, tokyo, sendai];

test('haversineMeters returns zero for identical points', () => {
  assert.equal(haversineMeters(tokyo.lat, tokyo.lng, tokyo.lat, tokyo.lng), 0);
});

test('haversineMeters measures roughly 831 km from Tokyo to Sapporo', () => {
  const distance = haversineMeters(tokyo.lat, tokyo.lng, sapporo.lat, sapporo.lng);
  assert.ok(Math.abs(distance - 831_000) <= 10_000, `Distance was ${distance} m`);
});

test('nearestLocation finds the closest location', () => {
  const nearest = nearestLocation(locations, 35.68, 139.77);
  assert.equal(nearest.location, tokyo);
  assert.ok(nearest.distanceMeters > 0 && nearest.distanceMeters < 500);
});

test('nearestLocation returns null for an empty list', () => {
  assert.equal(nearestLocation([], tokyo.lat, tokyo.lng), null);
});

test('sortByDistance returns entries in ascending order without changing the input', () => {
  const input = Object.freeze([...locations]);
  const sorted = sortByDistance(input, tokyo.lat, tokyo.lng);
  assert.deepEqual(sorted.map(({ location }) => location), [tokyo, sendai, sapporo]);
  assert.equal(sorted[0].distanceMeters, 0);
  assert.ok(sorted[0].distanceMeters < sorted[1].distanceMeters);
  assert.ok(sorted[1].distanceMeters < sorted[2].distanceMeters);
  assert.deepEqual(input, locations);
});
