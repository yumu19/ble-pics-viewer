import {
  MANUFACTURER_ID, STALE_AFTER_MS, SIGNAL_LABELS, processPics, hexDump,
  updateIntersection, recentHistory, demoPackets,
} from './pics.mjs';
import { AdvertisementScanner, DeviceAdvertisementWatcher, scanErrorMessage } from './bluetooth.mjs?v=20261031-2';
import { AdvertisementDiagnostics } from './debug.mjs';

const $ = id => document.getElementById(id);
const intersections = new Map();
const diagnostics = new AdvertisementDiagnostics();
const timeFormat = new Intl.DateTimeFormat('ja-JP', {
  hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3,
  hourCycle: 'h23',
});
const scanSupported = window.isSecureContext && typeof navigator.bluetooth?.requestLEScan === 'function';
const watchSupported = window.isSecureContext && typeof navigator.bluetooth?.requestDevice === 'function'
  && typeof window.BluetoothDevice?.prototype.watchAdvertisements === 'function';
const requestedMethod = new URLSearchParams(window.location.search).get('mode');
if (requestedMethod === 'watch' || requestedMethod === 'scan') {
  $('reception-method').value = requestedMethod;
} else if (!scanSupported && watchSupported) {
  $('reception-method').value = 'watch';
}
const watchingDevice = () => $('reception-method').value === 'watch';
const supported = () => watchingDevice() ? watchSupported : scanSupported;
let mode = 'idle';
let selectedId = '';
let packetCount = 0;
let invalidCount = 0;
let demoTimer = null;
let demoStep = 0;
let demoData = false;

const signalCards = Array.from({ length: 6 }, (_, index) => {
  const card = document.createElement('article');
  card.className = 'signal';
  // Only fixed markup is used here. All received values are assigned via textContent.
  card.innerHTML = `<h3 class="signal-heading">信号${index + 1}${index < 2 ? [' · 東西', ' · 南北'][index] : ''}</h3><div class="signal-body"><span class="lamp" aria-hidden="true"></span><div><span class="signal-state">未受信</span><p class="remaining">残り値 —</p></div></div>`;
  $('signals').append(card);
  return {
    card,
    state: card.querySelector('.signal-state'),
    remaining: card.querySelector('.remaining'),
  };
});

function updateCompatibility() {
  const api = watchingDevice() ? 'requestDevice / watchAdvertisements' : 'requestLEScan';
  $('watch-notice').hidden = !watchingDevice();
  if (!window.isSecureContext) {
    $('compatibility').textContent = '実機受信にはHTTPSまたはhttp://localhostが必要です。現在の環境ではデモを利用できます。';
  } else if (!supported()) {
    $('compatibility').textContent = `この環境では選択した受信方式（${api}）を利用できません。対応するChromeで実験的機能を有効にしてください。詳しくは下の「動作環境・使い方」を確認してください。デモは利用できます。`;
  } else {
    $('compatibility').textContent = `${api}を検出しました。実際の受信可否はOS・Bluetoothアダプター・権限に依存します。開始操作後にブラウザの許可・選択画面で操作してください。`;
  }
}
updateCompatibility();

function setMode(next) {
  mode = next;
  $('mode').dataset.mode = mode;
  $('mode').textContent = { idle: '停止中', requesting: '許可待ち', scanning: watchingDevice() ? '広告監視中' : 'スキャン中', demo: 'デモ' }[mode];
  $('start').textContent = watchingDevice() ? 'デバイスを選んで監視' : 'スキャン開始';
  $('start').disabled = !supported() || mode === 'scanning' || mode === 'requesting';
  $('reception-method').disabled = mode !== 'idle';
  $('demo').disabled = mode === 'demo' || mode === 'requesting';
  $('stop').disabled = mode === 'idle';
  $('status').textContent = {
    idle: '停止中です。表示は最後に受信したデータです。',
    requesting: watchingDevice() ? 'デバイスの選択・広告監視の開始を待っています…' : 'ブラウザのスキャン許可を待っています…',
    scanning: watchingDevice() ? `選択したデバイス「${receiver().device?.name || '名称なし'}」の広告を監視中です。GATT接続は行いません。` : 'BLEスキャン実行中です。受信したメーカーID 0x01CE のデータを解析します。',
    demo: '架空の交差点データを1秒ごとに更新しています。',
  }[mode];
  render();
}

const receiverCallbacks = {
  onState: setMode,
  onAdvertisement(event) {
    if ($('debug-enabled').checked) diagnostics.record(event);
    const data = event.manufacturerData?.get(MANUFACTURER_ID);
    if (!data) return;
    receive(data, {
      deviceName: event.name || event.device?.name || '',
      rssi: Number.isFinite(event.rssi) ? event.rssi : null,
    });
  },
};
const receivers = {
  scan: new AdvertisementScanner(navigator.bluetooth, receiverCallbacks),
  watch: new DeviceAdvertisementWatcher(navigator.bluetooth, receiverCallbacks),
};
const receiver = () => receivers[$('reception-method').value];

function resetData(isDemo = false) {
  demoData = isDemo;
  intersections.clear();
  selectedId = '';
  packetCount = 0;
  invalidCount = 0;
  diagnostics.clear();
  $('error').hidden = true;
  updateOptions();
  render();
}

function receive(raw, metadata) {
  try {
    const info = processPics(raw);
    const id = info.intersection_id;
    // Bound memory even if many distinct intersections are observed during a session.
    if (!intersections.has(id) && intersections.size >= 100) {
      const oldest = intersections.keys().next().value;
      intersections.delete(oldest);
      if (selectedId === oldest) selectedId = '';
    }
    const previous = intersections.get(id);
    const entry = updateIntersection(previous, info, raw, Date.now(), metadata);
    intersections.set(id, entry);
    packetCount++;
    if (!selectedId) selectedId = id;
    if (!previous || previous.identifier !== entry.identifier) updateOptions();
    render();
  } catch (error) {
    invalidCount++;
    $('invalid-count').textContent = `不正パケット: ${invalidCount}（最新: ${error.message}）`;
  }
}

function updateOptions() {
  const options = Array.from(intersections, ([id, entry]) => {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = entry.identifier ? `${entry.identifier} / ${id}` : id;
    return option;
  });
  if (!options.length) {
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '受信待ち';
    options.push(placeholder);
  }
  $('intersection').replaceChildren(...options);
  $('intersection').value = selectedId;
  $('intersection').disabled = intersections.size === 0;
}

function formatRemaining(signal) {
  return !signal || signal.remaining_time < 0 ? '—' : String(signal.remaining_time);
}

function render() {
  $('demo-notice').hidden = !demoData;
  const entry = intersections.get(selectedId);
  const now = Date.now();
  const running = mode === 'scanning' || mode === 'demo';
  const hasSignals = entry?.signalTimestamp != null;
  const stale = hasSignals && (!running || now - entry.signalTimestamp >= STALE_AFTER_MS);
  $('signals').classList.toggle('is-stale', Boolean(stale));
  $('freshness').classList.toggle('stale', Boolean(stale));
  $('freshness').textContent = hasSignals
    ? `${stale ? (running ? '更新なし' : '停止中 · 最終受信値') : '信号データ受信中'} · 最終信号受信 ${timeFormat.format(entry.signalTimestamp)} · ${Math.max(0, Math.floor((now - entry.signalTimestamp) / 1000))}秒前`
    : 'Type 2（信号状態）の受信待ち';

  for (const [index, { card, state, remaining }] of signalCards.entries()) {
    const signal = entry?.pedestrian_signals?.[index];
    card.dataset.state = signal?.signal_state ?? '';
    state.textContent = signal ? SIGNAL_LABELS[signal.signal_state] : '未受信';
    remaining.textContent = `残り値 ${formatRemaining(signal)}`;
  }
  $('intersection-name').textContent = entry
    ? (entry.identifier || entry.deviceName || `交差点 ${selectedId}`)
    : '交差点の情報を待っています';
  $('coordinates').textContent = entry?.latitude != null && entry?.longitude != null
    ? `${entry.latitude.toFixed(6)}, ${entry.longitude.toFixed(6)}` : '位置情報 未受信';
  $('received-at').textContent = entry ? timeFormat.format(entry.timestamp) : '—';
  $('message-type').textContent = entry ? `Type ${entry.latest.message_type} / ID ${entry.latest.message_id}` : '—';
  $('rssi').textContent = entry?.rssi != null ? `${entry.rssi} dBm` : '—';
  $('packet-count').textContent = String(packetCount);
  $('raw').textContent = entry ? hexDump(entry.raw) : 'パケット未受信';
  $('parsed').textContent = entry ? JSON.stringify(entry.latest, null, 2) : '{}';
  if (!invalidCount) $('invalid-count').textContent = '不正パケット: 0';
  renderHistory(entry, now);
  renderDebug(now);
}

function renderDebug(now = Date.now()) {
  const enabled = $('debug-enabled').checked;
  $('debug-panel').hidden = !enabled;
  if (!enabled) return;
  const { count, picsCount, lastTimestamp, devices, events } = diagnostics;
  $('debug-count').textContent = String(count);
  $('debug-devices').textContent = String(devices.size);
  $('debug-pics-count').textContent = String(picsCount);
  const age = lastTimestamp == null ? null : Math.max(0, Math.floor((now - lastTimestamp) / 1000));
  $('debug-last').textContent = lastTimestamp == null ? '—' : `${timeFormat.format(lastTimestamp)} · ${age}秒前`;
  let status;
  if (mode === 'demo') {
    status = 'デモ表示中です。Bluetoothのスキャンは実行していません。実機の受信確認には「スキャン開始」を押してください。';
  } else if (!supported()) {
    status = '選択した受信方式のAPIを利用できません。上の動作環境の案内を確認してください。';
  } else if (mode === 'requesting') {
    status = watchingDevice() ? 'デバイス選択・広告監視の開始待ちです。実際の広告はまだ受信していません。' : 'スキャン許可待ちです。スキャン開始はまだ確認できていません。';
  } else if (mode === 'scanning' && count === 0) {
    status = watchingDevice() ? '広告監視開始済み · 選択したデバイスの広告はまだ受信していません。デバイスの選択成功と広告の受信成功は別です。送信を続けている機器で確認してください。' : 'スキャン開始済み · 受信待ちです。実際のBLE受信はまだ確認できていません。周囲のBLE機器のアドバタイズ送信、OSとブラウザの権限を確認してください。';
  } else if (mode === 'scanning') {
    status = age < 5
      ? 'BLEアドバタイズの受信を確認できました。PICS信号機がなくてもスキャン・受信できています。'
      : `このセッションでBLE受信を確認済みです。直近${age}秒は受信がありません。`;
  } else {
    status = count
      ? '停止中 · 以下は実際に受信したログです。現在はスキャンしていません。'
      : '停止中 · 「スキャン開始」を押して周囲のBLEアドバタイズを確認してください。';
  }
  $('debug-status').textContent = status;
  $('debug-status').dataset.received = String(mode === 'scanning' && count > 0 && age < 5);
  const rows = Array.from(devices.values()).reverse().map(device => {
    const row = document.createElement('tr');
    const values = [
      timeFormat.format(device.timestamp), device.name,
      device.rssi == null ? '—' : `${device.rssi} dBm`,
      device.manufacturerData.map(data => data.companyIdentifier).join(', ') || 'なし',
      String(device.count),
    ];
    values.forEach((value, index) => {
      const cell = document.createElement('td');
      cell.textContent = value;
      if (index === 1) {
        cell.className = 'device-name';
        const id = document.createElement('small');
        id.textContent = device.deviceId;
        cell.append(id);
      }
      row.append(cell);
    });
    return row;
  });
  if (!rows.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 5;
    cell.className = 'empty';
    cell.textContent = count ? 'デバイスIDを含むイベントは未受信です。詳細ログを確認してください。' : 'BLEアドバタイズ未受信';
    row.append(cell);
    rows.push(row);
  }
  $('debug-device-list').replaceChildren(...rows);
  $('debug-log').textContent = events.length
    ? JSON.stringify(events.slice().reverse().map(event => ({ ...event, receivedAt: timeFormat.format(event.timestamp) })), null, 2)
    : 'アドバタイズ未受信';
}

function renderHistory(entry, now) {
  const entries = recentHistory(entry?.history ?? [], now).reverse();
  const rows = entries.map(item => {
    const row = document.createElement('tr');
    const values = [timeFormat.format(item.timestamp), ...item.signals.slice(0, 2).map(signal => SIGNAL_LABELS[signal.signal_state])];
    while (values.length < 3) values.push('未受信');
    values.push(`${formatRemaining(item.signals[0])} / ${formatRemaining(item.signals[1])}`);
    values.forEach((value, index) => {
      const cell = document.createElement('td');
      cell.textContent = value;
      if (index === 1 || index === 2) {
        cell.className = 'state-label';
        cell.dataset.state = item.signals[index - 1]?.signal_state ?? '';
      }
      row.append(cell);
    });
    return row;
  });
  if (!rows.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 4;
    cell.className = 'empty';
    cell.textContent = '直近30秒の信号受信履歴はありません';
    row.append(cell);
    rows.push(row);
  }
  $('history').replaceChildren(...rows);
}

function stopReception(message) {
  clearInterval(demoTimer);
  demoTimer = null;
  receiver().stop();
  if (message) $('status').textContent = message;
}

$('start').addEventListener('click', async () => {
  if (!supported() || mode === 'requesting' || mode === 'scanning') return;
  stopReception();
  resetData();
  try {
    // Called directly in this click handler to preserve transient user activation.
    await receiver().start();
  } catch (error) {
    $('error').textContent = scanErrorMessage(error);
    $('error').hidden = false;
  }
});

$('demo').addEventListener('click', () => {
  stopReception();
  resetData(true);
  demoStep = 0;
  setMode('demo');
  const tick = () => {
    for (const packet of demoPackets(demoStep++)) receive(packet, { deviceName: 'デモ交差点', rssi: null });
  };
  tick();
  demoTimer = setInterval(tick, 1000);
});
$('stop').addEventListener('click', () => stopReception());
$('reception-method').addEventListener('change', () => {
  resetData(demoData);
  updateCompatibility();
  setMode(mode);
});
$('debug-enabled').addEventListener('change', () => {
  diagnostics.clear();
  // Remove rendered data as well when disabling diagnostics.
  $('debug-device-list').replaceChildren();
  $('debug-log').textContent = 'アドバタイズ未受信';
  renderDebug();
});
$('debug-clear').addEventListener('click', () => {
  diagnostics.clear();
  renderDebug();
});
$('intersection').addEventListener('change', event => {
  selectedId = event.target.value;
  render();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && mode !== 'idle') stopReception('ページが非表示になったため停止しました。再開するにはスキャン開始、またはデモを押してください。');
});
window.addEventListener('pagehide', () => stopReception());
setInterval(() => {
  if (mode === 'scanning' && receiver().scan && !receiver().scan.active) {
    stopReception('ブラウザが受信を停止しました。再開するには開始ボタンを押してください。');
  }
  render();
}, 1000);
setMode('idle');
$('status').textContent = 'スキャン開始、またはデモを選んでください。';
