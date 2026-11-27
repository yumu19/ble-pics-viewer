# PICS Viewer — Python版

高度化PICSのBLEアドバタイズをBleakで受信し、信号状態・解析結果・履歴をターミナルに表示します。

## 事前準備

Pythonの動作環境を構築してください。Python 3.14.0 にて動作確認しています。

```bash
pip install pyyaml bleak
```

## 起動

リポジトリのルートから実行する場合:

```bash
python python/ble-pics-viewer.py
```

このディレクトリから実行する場合:

```bash
python ble-pics-viewer.py
```

Bluetoothを有効にし、必要に応じてOSのBluetoothアクセス権限を許可してください。`Ctrl+C` で停止します。

高度化PICSの概要とデモは [リポジトリの説明](../README.md)、ブラウザ版は [Web版の説明](../docs/web.md) を参照してください。
