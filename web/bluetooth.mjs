// Kept separate from the UI so permission prompts and cancellation can be tested.
export class AdvertisementScanner {
  constructor(bluetooth, { onAdvertisement, onState }) {
    this.bluetooth = bluetooth;
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
      this.bluetooth.removeEventListener('advertisementreceived', this.listener);
      this.listening = false;
    }
    this.setMode('idle');
  }

  setMode(mode) {
    this.mode = mode;
    this.onState(mode);
  }
}

export function scanErrorMessage(error) {
  const messages = {
    NotAllowedError: 'スキャンが許可されませんでした。ブラウザとOSのBluetooth権限を確認して、再度開始してください。',
    NotFoundError: 'スキャン要求がキャンセルされたか、Bluetoothアダプターが見つかりません。',
    NotSupportedError: 'このブラウザ・OSではアドバタイズのスキャンを利用できません。動作環境・使い方を確認してください。',
    SecurityError: 'スキャンがセキュリティ設定で制限されています。HTTPSまたはlocalhostで直接ページを開き、サイトのBluetooth権限を確認してください。',
    InvalidStateError: 'Bluetoothが無効、またはスキャンを開始できない状態です。端末のBluetooth設定を確認してください。',
    AbortError: 'スキャンが中断されました。再度開始してください。',
  };
  return messages[error?.name] ?? `スキャンを開始できませんでした: ${error?.message ?? String(error)}`;
}
