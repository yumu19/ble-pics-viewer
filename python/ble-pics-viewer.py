import struct, asyncio, json, os
from datetime import datetime, timedelta
from bleak import BleakScanner
from collections import deque

# =========================================
# PICS データ解析
# =========================================
def process_pics(data):
    pics_info = {}
    msg_type = data[2]
    pics_info['message_type'] = msg_type
    pics_info['message_id'] = data[3]
    pics_info['intersection_id'] = "".join([hex(num)[2:].upper().zfill(2) for num in data[6:10]])

    if msg_type == 0:
        identifier = bytes(data[10:24]).decode(errors='ignore').strip('\x00')
        pics_info['identifier'] = identifier
    elif msg_type == 1:
        pics_info['latitude']  = struct.unpack('>i', bytes(data[10:14]))[0] / 1_000_000
        pics_info['longitude'] = struct.unpack('>i', bytes(data[14:18]))[0] / 1_000_000
    elif msg_type == 2:
        pedestrian_signals = []
        for i in range(6):
            if 10 + i < len(data):
                signal_byte = data[10 + i]
                remaining_time = int((signal_byte >> 4) & 0x0F)
                signal_state = int(signal_byte & 0x0F)
                pedestrian_signals.append({
                    'remaining_time': -1 if remaining_time >= 8 else remaining_time + 1,
                    'signal_state': {
                        0: 'NoSignal', 1: 'Red', 2: 'BlinkGreen', 3: 'Green', 4: 'None'
                    }.get(signal_state, 'Unknown')
                })
        pics_info['pedestrian_signals'] = pedestrian_signals
    return pics_info


def state_symbol(state):
    symbols = {
        'NoSignal': ' ',
        'Red': '🔴',
        'BlinkGreen': '🟢(B)',
        'Green': '🟢',
        'None': '・',
        'Unknown': '?'
    }
    return symbols.get(state, '?')


# =========================================
# グローバル変数
# =========================================
latest_info = None
latest_raw = None
latest_timestamp = None
last_signal_info = None
log_history = deque(maxlen=5)  # 履歴は最大5件のみ


# =========================================
# BLE 受信コールバック
# =========================================
def detection_callback(device, advertisement_data):
    global latest_info, latest_raw, latest_timestamp, last_signal_info

    for manufacturer_id, data_bytes in advertisement_data.manufacturer_data.items():
        if manufacturer_id != 0x01CE:
            continue

        data = list(data_bytes)
        pics_info = process_pics(data)
        if not pics_info:
            return

        latest_info = pics_info
        latest_raw = data
        latest_timestamp = datetime.now()

        # ---- Type2のときのみ信号更新 ----
        if pics_info.get('message_type') == 2:
            last_signal_info = pics_info  # 保持
            s1 = pics_info['pedestrian_signals'][0]
            s2 = pics_info['pedestrian_signals'][1]
            log_history.append({"time": latest_timestamp, "s1": s1, "s2": s2})

        # ---- 画面更新 ----
        os.system("clear")
        print("=== リアルタイム PICS 信号監視 ===")
        print("時刻(ms)           | 東西 | 南北 | 残り(東西,南北)")
        print("----------------------------------------------")

        # Type2が届いていない場合でも前回の信号を保持表示
        if last_signal_info:
            s1 = last_signal_info['pedestrian_signals'][0]
            s2 = last_signal_info['pedestrian_signals'][1]
            print(f"{latest_timestamp.strftime('%H:%M:%S.%f')[:-3]} | "
                  f"{state_symbol(s1['signal_state']):^6} | "
                  f"{state_symbol(s2['signal_state']):^6} | "
                  f"({s1['remaining_time']},{s2['remaining_time']})")
        else:
            print("(受信待ち...)")
        print("\n")

        # ---- 解析結果モニタ ----
        print("=== 高度化PICS アドバタイズ受信モニタ ===")
        hex_dump = " ".join(f"{b:02X}" for b in data)
        print(f"[受信時刻] {latest_timestamp.strftime('%H:%M:%S.%f')[:-3]}")
        print("[Raw Packet 16進ダンプ]")
        print(hex_dump)
        print("\n[解析結果]")
        print(json.dumps(pics_info, ensure_ascii=False, indent=2))
        print("----------------------------------------------\n")

        # ---- 履歴表示（最大5件）----
        now = datetime.now()
        print("=== 過去30秒間の信号履歴（最大5件） ===")
        recent_entries = [entry for entry in list(log_history)
                          if now - entry["time"] <= timedelta(seconds=30)]
        for entry in recent_entries:
            t = entry["time"].strftime("%H:%M:%S.%f")[:-3]
            s1 = entry["s1"]
            s2 = entry["s2"]
            print(f"{t} | {state_symbol(s1['signal_state']):^6} | "
                  f"{state_symbol(s2['signal_state']):^6} | "
                  f"({s1['remaining_time']},{s2['remaining_time']})")
        print("----------------------------------------------")


# =========================================
# メイン関数
# =========================================
async def scan_ble_live_monitor_hold_last():
    scanner = BleakScanner(detection_callback)
    await scanner.start()
    print("BLEスキャン開始中（Ctrl+Cで停止）...\n")
    try:
        while True:
            await asyncio.sleep(0.2)
    except KeyboardInterrupt:
        print("\n停止しました。")
    finally:
        await scanner.stop()


# =========================================
# エントリーポイント
# =========================================
if __name__ == "__main__":
    try:
        asyncio.run(scan_ble_live_monitor_hold_last())
    except RuntimeError:
        import nest_asyncio
        nest_asyncio.apply()
        asyncio.run(scan_ble_live_monitor_hold_last())
