import test from 'node:test';
import assert from 'node:assert/strict';
import { AdvertisementDiagnostics } from '../debug.mjs';

function advertisement(id = 'browser-device-1', manufacturerId = 0x004c) {
  const storage = Uint8Array.from([0xff, 0xaa, 0xbb, 0xcc, 0xff]);
  return {
    device: { id, name: 'BLE beacon' },
    rssi: -57,
    txPower: -12,
    uuids: ['0000180f-0000-1000-8000-00805f9b34fb'],
    manufacturerData: new Map([[manufacturerId, new DataView(storage.buffer, 1, 3)]]),
    serviceData: new Map([['battery_service', new DataView(Uint8Array.of(100).buffer)]]),
  };
}

test('non-PICS advertisements confirm reception and expose only the DataView payload', () => {
  const debug = new AdvertisementDiagnostics();
  const entry = debug.record(advertisement(), 1000);
  assert.equal(debug.count, 1);
  assert.equal(debug.picsCount, 0);
  assert.equal(debug.lastTimestamp, 1000);
  assert.equal(debug.devices.size, 1);
  assert.deepEqual(entry.manufacturerData, [{ companyIdentifier: '0x004C', data: 'AA BB CC' }]);
  assert.deepEqual(entry.serviceData, [{ uuid: 'battery_service', data: '64' }]);
  assert.equal(entry.rssi, -57);
  assert.equal(entry.txPower, -12);
});

test('repeated packets increment counts without duplicating devices', () => {
  const debug = new AdvertisementDiagnostics();
  debug.record(advertisement(), 1000);
  debug.record(advertisement(), 2000);
  assert.equal(debug.count, 2);
  assert.equal(debug.devices.size, 1);
  assert.equal(debug.devices.get('browser-device-1').count, 2);
  assert.equal(debug.devices.get('browser-device-1').timestamp, 2000);
});

test('PICS manufacturer events are counted even if the payload is not parseable as PICS', () => {
  const debug = new AdvertisementDiagnostics();
  debug.record(advertisement('pics-device', 0x01ce));
  assert.equal(debug.count, 1);
  assert.equal(debug.picsCount, 1);
  assert.equal(debug.events[0].manufacturerData[0].companyIdentifier, '0x01CE');
});

test('events with no name or manufacturer data still prove reception', () => {
  const debug = new AdvertisementDiagnostics();
  const entry = debug.record({ device: { id: 'unnamed' } }, 1234);
  assert.equal(debug.count, 1);
  assert.equal(debug.devices.size, 1);
  assert.equal(entry.name, '名称なし');
  assert.equal(entry.rssi, null);
  assert.equal(entry.txPower, null);
  assert.deepEqual(entry.manufacturerData, []);
  assert.deepEqual(entry.serviceData, []);
  assert.deepEqual(entry.uuids, []);
  debug.record({}, 1235);
  assert.equal(debug.count, 2);
  assert.equal(debug.devices.size, 1);
});

test('log snapshots are not modified by subsequent buffer changes', () => {
  const debug = new AdvertisementDiagnostics();
  const event = advertisement();
  debug.record(event);
  event.manufacturerData.get(0x004c).setUint8(0, 0);
  event.uuids.push('another-service');
  assert.equal(debug.events[0].manufacturerData[0].data, 'AA BB CC');
  assert.equal(debug.events[0].uuids.length, 1);
});

test('keeps the last 20 events and 100 recently seen devices, retaining total counts', () => {
  const debug = new AdvertisementDiagnostics();
  for (let i = 0; i < 150; i++) debug.record(advertisement(`device-${i}`), i);
  assert.equal(debug.count, 150);
  assert.equal(debug.devices.size, 100);
  assert.equal(debug.events.length, 20);
  assert.equal(debug.events[0].timestamp, 130);
  assert.equal(debug.devices.has('device-0'), false);
  debug.record(advertisement('device-50'), 200);
  debug.record(advertisement('new-device'), 201);
  assert.equal(debug.devices.has('device-50'), true);
  assert.equal(debug.devices.has('device-51'), false);
});

test('clear removes all diagnostic data and restarts counters', () => {
  const debug = new AdvertisementDiagnostics();
  debug.record(advertisement('pics-device', 0x01ce));
  debug.clear();
  assert.equal(debug.count, 0);
  assert.equal(debug.picsCount, 0);
  assert.equal(debug.lastTimestamp, null);
  assert.equal(debug.devices.size, 0);
  assert.deepEqual(debug.events, []);
});
