// Manufacturer-specific payload only: the company identifier (CE 01) is not included.
export const MANUFACTURER_ID = 0x01ce;
export const HISTORY_WINDOW_MS = 30_000;
export const STALE_AFTER_MS = 5_000;

const SIGNAL_STATES = ['NoSignal', 'Red', 'BlinkGreen', 'Green', 'None'];
export const SIGNAL_LABELS = {
  NoSignal: '信号なし', Red: '赤', BlinkGreen: '青点滅', Green: '青',
  None: '対象なし', Unknown: '不明',
};

export function toBytes(data) {
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  throw new TypeError('パケットにはArrayBufferまたはTypedArrayを指定してください。');
}

export function hexDump(data) {
  return Array.from(toBytes(data), byte => byte.toString(16).padStart(2, '0').toUpperCase()).join(' ');
}

// Byte offsets and signal encodings follow process_pics() in ble-pics-viewer.py.
export function processPics(data) {
  const bytes = toBytes(data);
  if (bytes.length < 10) throw new RangeError('PICSヘッダーが短すぎます（10バイト以上必要）。');
  const type = bytes[2];
  const minimumLength = { 0: 24, 1: 18, 2: 11 }[type] ?? 10;
  if (bytes.length < minimumLength) {
    throw new RangeError(`Type ${type}のパケットが短すぎます（${minimumLength}バイト以上必要）。`);
  }
  const info = {
    message_type: type,
    message_id: bytes[3],
    intersection_id: hexDump(bytes.subarray(6, 10)).replaceAll(' ', ''),
  };
  if (type === 0) {
    info.identifier = new TextDecoder().decode(bytes.subarray(10, 24))
      .replaceAll('\uFFFD', '').replace(/^\0+|\0+$/g, '');
  } else if (type === 1) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    info.latitude = view.getInt32(10, false) / 1_000_000;
    info.longitude = view.getInt32(14, false) / 1_000_000;
  } else if (type === 2) {
    info.pedestrian_signals = Array.from(bytes.subarray(10, 16), byte => ({
      remaining_time: (byte >> 4) >= 8 ? -1 : (byte >> 4) + 1,
      signal_state: SIGNAL_STATES[byte & 0x0f] ?? 'Unknown',
    }));
  }
  return info;
}

export function recentHistory(history, now = Date.now()) {
  return history.filter(entry => now - entry.timestamp <= HISTORY_WINDOW_MS).slice(-5);
}

export function updateIntersection(previous, info, raw, timestamp, metadata = {}) {
  const entry = {
    ...previous,
    ...info,
    ...metadata,
    timestamp,
    raw: Uint8Array.from(toBytes(raw)),
    latest: info,
    history: recentHistory(previous?.history ?? [], timestamp),
    count: (previous?.count ?? 0) + 1,
  };
  if (info.message_type === 2) {
    entry.signalTimestamp = timestamp;
    entry.history = recentHistory([...entry.history, {
      timestamp, signals: info.pedestrian_signals,
    }], timestamp);
  }
  return entry;
}

// Synthetic advertisements, decoded through exactly the same path as received data.
export function demoPackets(step) {
  const header = (type, length) => {
    const data = new Uint8Array(length);
    data[2] = type;
    data[3] = step % 256;
    data.set([0x00, 0x00, 0x00, 0x01], 6);
    return data;
  };
  const name = header(0, 24);
  name.set(new TextEncoder().encode('DEMO CROSSING'), 10);
  const position = header(1, 18);
  const view = new DataView(position.buffer);
  view.setInt32(10, 35_681_236, false);
  view.setInt32(14, 139_767_125, false);
  const signals = header(2, 16);
  const phase = step % 24;
  const eastWest = phase < 8 ? 3 : phase < 12 ? 2 : 1;
  const northSouth = phase < 12 ? 1 : phase < 20 ? 3 : 2;
  const remaining = (7 - (step % 8)) << 4;
  signals.set([remaining | eastWest, remaining | northSouth, 0x84, 0x84, 0x84, 0x84], 10);
  return step === 0 ? [name, position, signals] : [signals];
}
