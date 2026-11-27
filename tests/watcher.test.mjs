import test from 'node:test';
import assert from 'node:assert/strict';
import { DeviceAdvertisementWatcher } from '../bluetooth.mjs';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function deviceHarness() {
  const device = new EventTarget();
  device.id = 'selected-device';
  device.name = 'Selected beacon';
  device.watchingAdvertisements = false;
  Object.defineProperty(device, 'gatt', { get() { throw new Error('GATT must never be accessed'); } });
  const pendingWatch = deferred();
  let signal;
  let calls = 0;
  device.watchAdvertisements = async options => {
    calls++;
    signal = options.signal;
    signal.addEventListener('abort', () => { device.watchingAdvertisements = false; });
    await pendingWatch.promise;
    device.watchingAdvertisements = !signal.aborted;
  };
  return { device, pendingWatch, get signal() { return signal; }, get calls() { return calls; } };
}

function harness() {
  const h = deviceHarness();
  const bluetooth = new EventTarget();
  const choice = deferred();
  let options;
  bluetooth.requestDevice = value => { options = value; return choice.promise; };
  const states = [];
  let received = 0;
  const watcher = new DeviceAdvertisementWatcher(bluetooth, {
    onAdvertisement: () => received++,
    onState: mode => states.push(mode),
  });
  return { h, bluetooth, choice, states, watcher, get options() { return options; }, get received() { return received; } };
}

test('filters unnamed PICS candidates by manufacturer ID and receives ads without accessing GATT', async () => {
  const t = harness();
  const started = t.watcher.start();
  assert.deepEqual(t.options, {
    filters: [{ manufacturerData: [{ companyIdentifier: 0x01ce }] }],
    optionalManufacturerData: [0x01ce],
  });
  t.h.device.name = '';
  t.choice.resolve(t.h.device);
  t.h.pendingWatch.resolve();
  assert.equal(await started, true);
  assert.deepEqual(t.states, ['requesting', 'scanning']);
  assert.equal(t.received, 0, 'selection and starting a watcher do not count as an advertisement');
  t.h.device.dispatchEvent(new Event('advertisementreceived'));
  t.h.device.dispatchEvent(new Event('advertisementreceived'));
  assert.equal(t.received, 2);
  t.watcher.stop();
  assert.equal(t.h.signal.aborted, true);
  assert.equal(t.h.device.watchingAdvertisements, false);
  t.h.device.dispatchEvent(new Event('advertisementreceived'));
  assert.equal(t.received, 2);
  assert.equal(t.watcher.mode, 'idle');
});

test('all-device diagnostics use an unfiltered chooser while preserving PICS data permission', async () => {
  const t = harness();
  const started = t.watcher.start({ picsOnly: false });
  assert.deepEqual(t.options, { acceptAllDevices: true, optionalManufacturerData: [0x01ce] });
  t.choice.resolve(t.h.device);
  t.h.pendingWatch.resolve();
  assert.equal(await started, true);
  t.h.device.dispatchEvent(new Event('advertisementreceived'));
  assert.equal(t.received, 1);
  t.watcher.stop();
});

test('stopping while the chooser is open does not start a watcher on a late selection', async () => {
  const t = harness();
  const started = t.watcher.start();
  t.watcher.stop();
  t.choice.resolve(t.h.device);
  assert.equal(await started, false);
  assert.equal(t.h.calls, 0);
  assert.equal(t.watcher.mode, 'idle');
});

test('stopping during watcher startup aborts and removes its event listener', async () => {
  const t = harness();
  const started = t.watcher.start();
  t.choice.resolve(t.h.device);
  await Promise.resolve();
  assert.equal(t.h.calls, 1);
  t.watcher.stop();
  assert.equal(t.h.signal.aborted, true);
  t.h.pendingWatch.resolve();
  assert.equal(await started, false);
  t.h.device.dispatchEvent(new Event('advertisementreceived'));
  assert.equal(t.received, 0);
  assert.equal(t.watcher.scan, null);
});

test('device chooser cancellation and missing watchAdvertisements restore idle state', async () => {
  const canceled = harness();
  const started = canceled.watcher.start();
  canceled.choice.reject(new DOMException('User cancelled the requestDevice() chooser.', 'NotFoundError'));
  await assert.rejects(started, { name: 'NotFoundError' });
  assert.equal(canceled.watcher.mode, 'idle');

  const unavailable = harness();
  const other = unavailable.watcher.start();
  unavailable.choice.resolve({ name: 'No watcher API' });
  await assert.rejects(other, { name: 'NotSupportedError' });
  assert.equal(unavailable.watcher.mode, 'idle');
});

test('watcher startup failure cleans up the listener and abort signal', async () => {
  const t = harness();
  const started = t.watcher.start();
  t.choice.resolve(t.h.device);
  t.h.pendingWatch.reject(new DOMException('Permission denied', 'NotAllowedError'));
  await assert.rejects(started, { name: 'NotAllowedError' });
  assert.equal(t.h.signal.aborted, true);
  t.h.device.dispatchEvent(new Event('advertisementreceived'));
  assert.equal(t.received, 0);
});

test('duplicate starts do not open additional choosers and active tracks browser-side stops', async () => {
  const t = harness();
  const started = t.watcher.start();
  assert.equal(await t.watcher.start(), false);
  t.choice.resolve(t.h.device);
  t.h.pendingWatch.resolve();
  await started;
  assert.equal(await t.watcher.start(), false);
  assert.equal(t.watcher.scan.active, true);
  t.h.device.watchingAdvertisements = false;
  assert.equal(t.watcher.scan.active, false);
  t.watcher.stop();
});

test('a previous watch failure after stop does not disturb a new device session', async () => {
  const t = harness();
  const first = t.watcher.start();
  t.choice.resolve(t.h.device);
  await Promise.resolve();
  t.watcher.stop();
  const secondDevice = deviceHarness();
  t.bluetooth.requestDevice = async () => secondDevice.device;
  secondDevice.pendingWatch.resolve();
  assert.equal(await t.watcher.start(), true);
  t.h.pendingWatch.reject(new DOMException('Old watcher aborted', 'AbortError'));
  assert.equal(await first, false);
  assert.equal(t.watcher.mode, 'scanning');
  assert.equal(secondDevice.signal.aborted, false);
  t.h.device.dispatchEvent(new Event('advertisementreceived'));
  assert.equal(t.received, 0);
  secondDevice.device.dispatchEvent(new Event('advertisementreceived'));
  assert.equal(t.received, 1);
  t.watcher.stop();
});
