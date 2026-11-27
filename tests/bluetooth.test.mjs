import test from 'node:test';
import assert from 'node:assert/strict';
import { AdvertisementScanner, scanErrorMessage } from '../bluetooth.mjs';

function harness() {
  const bluetooth = new EventTarget();
  let resolve;
  let reject;
  let options;
  const pending = new Promise((yes, no) => { resolve = yes; reject = no; });
  bluetooth.requestLEScan = value => { options = value; return pending; };
  const states = [];
  let received = 0;
  const scanner = new AdvertisementScanner(bluetooth, {
    onState: state => states.push(state),
    onAdvertisement: () => received++,
  });
  const scan = { active: true, stop() { this.active = false; } };
  return { bluetooth, scanner, scan, resolve, reject, states, get options() { return options; }, get received() { return received; } };
}

test('starts repeated advertisement reception and removes listener on stop', async () => {
  const h = harness();
  const started = h.scanner.start();
  assert.equal(h.scanner.mode, 'requesting');
  assert.deepEqual(h.options, { acceptAllAdvertisements: true, keepRepeatedDevices: true });
  h.resolve(h.scan);
  assert.equal(await started, true);
  h.bluetooth.dispatchEvent(new Event('advertisementreceived'));
  h.bluetooth.dispatchEvent(new Event('advertisementreceived'));
  assert.equal(h.received, 2);
  h.scanner.stop();
  assert.equal(h.scan.active, false);
  h.bluetooth.dispatchEvent(new Event('advertisementreceived'));
  assert.equal(h.received, 2);
  assert.deepEqual(h.states, ['requesting', 'scanning', 'idle']);
});

test('stopping during a permission prompt stops the scan when permission later resolves', async () => {
  const h = harness();
  const started = h.scanner.start();
  h.scanner.stop();
  h.resolve(h.scan);
  assert.equal(await started, false);
  assert.equal(h.scan.active, false);
  assert.equal(h.scanner.mode, 'idle');
  assert.equal(h.scanner.scan, null);
  h.bluetooth.dispatchEvent(new Event('advertisementreceived'));
  assert.equal(h.received, 0);
});

test('duplicate start calls do not create an extra scan', async () => {
  const h = harness();
  const started = h.scanner.start();
  assert.equal(await h.scanner.start(), false);
  h.resolve(h.scan);
  await started;
  assert.equal(await h.scanner.start(), false);
  h.scanner.stop();
});

test('permission failure cleans up and permits a retry', async () => {
  const h = harness();
  const started = h.scanner.start();
  const error = new DOMException('Denied', 'NotAllowedError');
  h.reject(error);
  await assert.rejects(started, { name: 'NotAllowedError' });
  assert.equal(h.scanner.mode, 'idle');
  h.bluetooth.dispatchEvent(new Event('advertisementreceived'));
  assert.equal(h.received, 0);
  h.bluetooth.requestLEScan = async () => h.scan;
  assert.equal(await h.scanner.start(), true);
  h.scanner.stop();
});

test('a stale permission rejection after stop does not disturb a subsequent session', async () => {
  const h = harness();
  const first = h.scanner.start();
  h.scanner.stop();
  h.bluetooth.requestLEScan = async () => h.scan;
  assert.equal(await h.scanner.start(), true);
  h.reject(new DOMException('Cancelled', 'NotAllowedError'));
  assert.equal(await first, false);
  assert.equal(h.scanner.mode, 'scanning');
  h.bluetooth.dispatchEvent(new Event('advertisementreceived'));
  assert.equal(h.received, 1);
  h.scanner.stop();
});

test('platform error messages distinguish permissions and missing scanning support', () => {
  assert.match(scanErrorMessage({ name: 'NotAllowedError' }), /権限/);
  assert.match(scanErrorMessage({ name: 'NotSupportedError' }), /利用できません/);
  assert.match(scanErrorMessage({ name: 'SecurityError' }), /HTTPS/);
  assert.match(scanErrorMessage(new Error('hardware failure')), /hardware failure/);
});

test('PROMPT_CANCELED does not assume the user dismissed the prompt or Bluetooth is off', () => {
  for (const spelling of ['canceled', 'cancelled']) {
    const error = new DOMException(`User ${spelling} the permission prompt.`, 'InvalidStateError');
    const message = scanErrorMessage(error);
    assert.match(message, /スキャン許可を完了できません/);
    assert.match(message, /ダイアログ表示失敗/);
    assert.match(message, /スキャン要求の重複/);
    assert.ok(message.includes(`${error.name}: ${error.message}`));
    assert.doesNotMatch(message, /Bluetoothが無効/);
  }
});

test('InvalidStateError explains an inactive document and retains unrecognized errors', () => {
  const inactive = new DOMException('The document is not active.', 'InvalidStateError');
  assert.match(scanErrorMessage(inactive), /このタブを表示/);
  const unknown = new DOMException('Adapter is not ready.', 'InvalidStateError');
  const message = scanErrorMessage(unknown);
  assert.match(message, /Bluetooth権限/);
  assert.ok(message.includes('InvalidStateError: Adapter is not ready.'));
});

test('known error categories retain the original browser error for diagnostics', () => {
  const error = new DOMException('requestLEScan() call is blocked by user.', 'NotAllowedError');
  const message = scanErrorMessage(error);
  assert.match(message, /権限/);
  assert.ok(message.includes(`${error.name}: ${error.message}`));
  assert.match(scanErrorMessage('Unexpected failure'), /Unexpected failure/);
  assert.doesNotThrow(() => scanErrorMessage(null));
});
