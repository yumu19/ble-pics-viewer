import { MANUFACTURER_ID } from './pics.mjs';

// Kept separate from the UI so permission prompts and cancellation can be tested.
export class AdvertisementScanner {
  constructor(bluetooth, { onAdvertisement, onState }) {
    this.bluetooth = bluetooth;
    this.eventTarget = bluetooth;
    this.onState = onState;
    this.mode = 'idle';
    this.scan = null;
    this.generation = 0;
    this.listening = false;
    this.listener = event => {
      if (this.mode === 'requesting' || this.mode === 'scanning') onAdvertisement(event);
    };
  }

  async start() {
    if (this.mode !== 'idle') return false;
    const generation = ++this.generation;
    this.setMode('requesting');
    try {
      this.bluetooth.addEventListener('advertisementreceived', this.listener);
      this.listening = true;
      // Repeated advertisements are essential: the same device changes signal state.
      // Accept all at the API level for compatibility with experimental implementations;
      // the application filters PICS data and can inspect all events in debug mode.
      const scan = await this.bluetooth.requestLEScan({
        acceptAllAdvertisements: true,
        keepRepeatedDevices: true,
      });
      if (generation !== this.generation) {
        scan.stop();
        return false;
      }
      this.scan = scan;
      this.setMode('scanning');
      return true;
    } catch (error) {
      if (generation !== this.generation) return false;
      this.stop();
      throw error;
    }
  }

  stop() {
    ++this.generation;
    this.scan?.stop();
    this.scan = null;
    if (this.listening) {
      this.eventTarget.removeEventListener('advertisementreceived', this.listener);
      this.listening = false;
    }
    this.setMode('idle');
  }

  setMode(mode) {
    this.mode = mode;
    this.onState(mode);
  }
}

// Alternative to requestLEScan: uses the normal device chooser and monitors one
// device's advertisements. No GATT connection or characteristic access is used.
export class DeviceAdvertisementWatcher extends AdvertisementScanner {
  async start({ picsOnly = true } = {}) {
    if (this.mode !== 'idle') return false;
    const generation = ++this.generation;
    this.setMode('requesting');
    try {
      const options = {
        // Without this permission the browser hides the PICS manufacturer data.
        optionalManufacturerData: [MANUFACTURER_ID],
      };
      if (picsOnly) {
        // Match the advertised company identifier even when no device name is
        // available. This finds candidates; the payload still needs decoding.
        options.filters = [{ manufacturerData: [{ companyIdentifier: MANUFACTURER_ID }] }];
      } else {
        options.acceptAllDevices = true;
      }
      const device = await this.bluetooth.requestDevice(options);
      if (generation !== this.generation) return false;
      if (typeof device.watchAdvertisements !== 'function') {
        throw new DOMException('watchAdvertisements() is not available. Enable experimental Web Platform features.', 'NotSupportedError');
      }
      const controller = new AbortController();
      this.abortController = controller;
      this.device = device;
      this.eventTarget = device;
      device.addEventListener('advertisementreceived', this.listener);
      this.listening = true;
      await device.watchAdvertisements({ signal: controller.signal });
      if (generation !== this.generation) {
        controller.abort();
        return false;
      }
      this.scan = {
        get active() { return !controller.signal.aborted && device.watchingAdvertisements; },
        stop() { controller.abort(); },
      };
      this.setMode('scanning');
      return true;
    } catch (error) {
      if (generation !== this.generation) return false;
      this.stop();
      throw error;
    }
  }

  stop() {
    this.abortController?.abort();
    this.abortController = null;
    this.device = null;
    super.stop();
  }
}

export function scanErrorMessage(error) {
  const messages = {
    NotAllowedError: 'スキャンが許可されませんでした。ブラウザとOSのBluetooth権限を確認して、再度開始してください。',
    NotFoundError: 'スキャン要求がキャンセルされたか、Bluetoothアダプターが見つかりません。',
    NotSupportedError: 'このブラウザ・OSではアドバタイズのスキャンを利用できません。動作環境・使い方を確認してください。',
    SecurityError: 'スキャンがセキュリティ設定で制限されています。HTTPSまたはlocalhostで直接ページを開き、サイトのBluetooth権限を確認してください。',
    InvalidStateError: 'スキャンを開始できない状態です。Bluetoothの電源、OSのChromeへのBluetooth権限、ページが表示中かを確認してください。',
    AbortError: 'スキャンが中断されました。再度開始してください。',
  };
  let message = messages[error?.name];
  // Chromium also uses PROMPT_CANCELED for an unavailable prompt UI or a
  // concurrent scan request. The message does not prove the user canceled it.
  // Do not misdiagnose either as a powered-off Bluetooth adapter.
  if (error?.name === 'InvalidStateError') {
    if (/user cancel(?:l)?ed the permission prompt/i.test(error.message ?? '')) {
      message = 'スキャン許可を完了できませんでした。ダイアログのキャンセル、Chrome側のダイアログ表示失敗、スキャン要求の重複が考えられます。ダイアログが表示されない場合は、Chromeを完全終了して開き直し、通常のタブで再度試してください。';
    } else if (/document is not active/i.test(error.message ?? '')) {
      message = 'ページがアクティブでないためスキャンを開始できません。このタブを表示した状態で「スキャン開始」を押してください。';
    }
  }
  const details = [error?.name, error?.message].filter(Boolean).join(': ') || String(error);
  return `${message ?? 'スキャンを開始できませんでした。'}\nブラウザ詳細: ${details}`;
}
