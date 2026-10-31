import test from 'node:test';
import assert from 'node:assert/strict';
import {
  processPics, hexDump, updateIntersection, recentHistory, demoPackets,
} from '../pics.mjs';

function packet(type, length = 24) {
  const bytes = new Uint8Array(length);
  bytes[2] = type;
  bytes[3] = 42;
  bytes.set([0x12, 0x34, 0xab, 0xcd], 6);
  return bytes;
}

test('Type 0 decodes UTF-8 identifier and common header', () => {
  const bytes = packet(0);
  bytes.set(new TextEncoder().encode('交差点A'), 10);
  assert.deepEqual(processPics(bytes), {
    message_type: 0, message_id: 42, intersection_id: '1234ABCD', identifier: '交差点A',
  });
});

test('Type 1 reads signed big-endian coordinates from a DataView with an offset', () => {
  const buffer = new Uint8Array(30).fill(0xff);
  const bytes = packet(1, 18);
  const view = new DataView(bytes.buffer);
  view.setInt32(10, -35_123_456, false);
  view.setInt32(14, 139_654_321, false);
  buffer.set(bytes, 5);
  const sliced = new DataView(buffer.buffer, 5, 18);
  const info = processPics(sliced);
  assert.equal(info.latitude, -35.123456);
  assert.equal(info.longitude, 139.654321);
  assert.equal(hexDump(sliced).split(' ').length, 18);
  assert.equal(hexDump(sliced), hexDump(bytes));
});

test('Type 2 decodes every signal state, remaining boundaries, and at most six signals', () => {
  const bytes = packet(2);
  bytes.set([0x00, 0x71, 0x82, 0xf3, 0x24, 0x0f, 0x33], 10);
  assert.deepEqual(processPics(bytes).pedestrian_signals, [
    { remaining_time: 1, signal_state: 'NoSignal' },
    { remaining_time: 8, signal_state: 'Red' },
    { remaining_time: -1, signal_state: 'BlinkGreen' },
    { remaining_time: -1, signal_state: 'Green' },
    { remaining_time: 3, signal_state: 'None' },
    { remaining_time: 1, signal_state: 'Unknown' },
  ]);
});

test('Type 2 permits a partial set of signals without inventing missing values', () => {
  const bytes = packet(2, 11);
  bytes[10] = 0x13;
  assert.equal(processPics(bytes).pedestrian_signals.length, 1);
});

test('rejects short common headers and truncated known messages', () => {
  for (const length of [0, 2, 6, 9]) assert.throws(() => processPics(new Uint8Array(length)), RangeError);
  for (const [type, length] of [[0, 23], [1, 17], [2, 10]]) {
    assert.throws(() => processPics(packet(type, length)), RangeError);
  }
});

test('unknown message types retain the common header', () => {
  assert.deepEqual(processPics(packet(99, 10)), {
    message_type: 99, message_id: 42, intersection_id: '1234ABCD',
  });
});

test('Type 0/1 updates retain the last signal and signal timestamp', () => {
  const [name, position, signals] = demoPackets(0);
  let entry = updateIntersection(undefined, processPics(signals), signals, 1000);
  const originalSignals = entry.pedestrian_signals;
  entry = updateIntersection(entry, processPics(name), name, 2000);
  entry = updateIntersection(entry, processPics(position), position, 3000);
  assert.strictEqual(entry.pedestrian_signals, originalSignals);
  assert.equal(entry.identifier, 'DEMO CROSSING');
  assert.equal(entry.latitude, 35.681236);
  assert.equal(entry.signalTimestamp, 1000);
  assert.equal(entry.timestamp, 3000);
  assert.equal(entry.history.length, 1);
  assert.equal(entry.count, 3);
  assert.equal(entry.latest.message_type, 1);
});

test('raw bytes are copied so later changes to the received buffer cannot alter the monitor', () => {
  const bytes = packet(2, 16);
  const entry = updateIntersection(undefined, processPics(bytes), bytes, 1000);
  bytes.fill(255);
  assert.equal(entry.raw[2], 2);
});

test('history retains five Type 2 packets and expires entries after 30 seconds', () => {
  const bytes = packet(2, 16);
  let entry;
  for (let i = 0; i < 10; i++) entry = updateIntersection(entry, processPics(bytes), bytes, i * 1000);
  assert.deepEqual(entry.history.map(item => item.timestamp), [5000, 6000, 7000, 8000, 9000]);
  assert.equal(recentHistory(entry.history, 35_000).length, 5);
  assert.equal(recentHistory(entry.history, 35_001).length, 4);
  assert.equal(recentHistory(entry.history, 39_001).length, 0);
});

test('intersection entries do not share signals or history', () => {
  const bytes = packet(2, 16);
  const first = updateIntersection(undefined, processPics(bytes), bytes, 1000);
  bytes[9] = 0xce;
  const second = updateIntersection(undefined, processPics(bytes), bytes, 2000);
  assert.notEqual(first.intersection_id, second.intersection_id);
  assert.equal(first.history[0].timestamp, 1000);
  assert.equal(second.history[0].timestamp, 2000);
});

test('demo cycles through red, green, and blinking green using real parser', () => {
  const states = new Set();
  for (let i = 0; i < 48; i++) {
    for (const bytes of demoPackets(i)) {
      const info = processPics(bytes);
      assert.equal(info.intersection_id, '00000001');
      for (const signal of info.pedestrian_signals ?? []) states.add(signal.signal_state);
    }
  }
  for (const state of ['Red', 'Green', 'BlinkGreen']) assert.ok(states.has(state));
});
