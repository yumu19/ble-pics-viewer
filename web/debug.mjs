import { MANUFACTURER_ID, hexDump } from './pics.mjs';

// Records real advertisement events only. PICS decoding is independent of this log.
export class AdvertisementDiagnostics {
  constructor() {
    this.clear();
  }

  clear() {
    this.count = 0;
    this.picsCount = 0;
    this.lastTimestamp = null;
    this.devices = new Map();
    this.events = [];
  }

  record(event, timestamp = Date.now()) {
    const manufacturerData = Array.from(event.manufacturerData ?? [], ([id, data]) => ({
      companyIdentifier: `0x${id.toString(16).padStart(4, '0').toUpperCase()}`,
      data: hexDump(data),
    }));
    const entry = {
      timestamp,
      deviceId: event.device?.id || null,
      name: event.name || event.device?.name || '名称なし',
      rssi: Number.isFinite(event.rssi) ? event.rssi : null,
      txPower: Number.isFinite(event.txPower) ? event.txPower : null,
      uuids: Array.from(event.uuids ?? []),
      manufacturerData,
      serviceData: Array.from(event.serviceData ?? [], ([uuid, data]) => ({ uuid, data: hexDump(data) })),
    };
    this.count++;
    if (event.manufacturerData?.has(MANUFACTURER_ID)) this.picsCount++;
    this.lastTimestamp = timestamp;
    if (entry.deviceId) {
      const previous = this.devices.get(entry.deviceId);
      // Keep recently seen devices, with a fixed memory bound.
      this.devices.delete(entry.deviceId);
      this.devices.set(entry.deviceId, { ...entry, count: (previous?.count ?? 0) + 1 });
      if (this.devices.size > 100) this.devices.delete(this.devices.keys().next().value);
    }
    this.events.push(entry);
    if (this.events.length > 20) this.events.shift();
    return entry;
  }
}
