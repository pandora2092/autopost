#!/usr/bin/env bash
# Установка уникального Android ID на устройстве через ADB.
# Использование: ./set-android-id.sh <adb_target> [android_id]
# adb_target: IP:port (например 192.168.122.5:5555) или serial.
# Если android_id не задан — генерируется случайный 16-символьный hex.

set -euo

ADB_TARGET="${1:?Usage: $0 <adb_target> [android_id]}"
ANDROID_ID="${2:-}"

generate_android_id() {
  # Android ID — 16 hex-символов. Генерируем из /dev/urandom.
  LC_ALL=C tr -dc '0-9a-f' </dev/urandom | head -c 16
}

if [[ -z "$ANDROID_ID" ]]; then
  ANDROID_ID=$(generate_android_id)
fi

# На всякий случай убираем лишние символы (пробелы, переносы, префиксы)
ANDROID_ID="${ANDROID_ID//[^0-9a-fA-F]/}"

# Проверка формата (hex, до 16 символов)
if ! [[ "$ANDROID_ID" =~ ^[0-9a-fA-F]{1,16}$ ]]; then
  echo "Ошибка: android_id должен быть hex (до 16 символов)." >&2
  exit 1
fi

# Дополнить до 16 символов при необходимости
while [[ ${#ANDROID_ID} -lt 16 ]]; do
  ANDROID_ID="0${ANDROID_ID}"
done

if ! command -v adb &>/dev/null; then
  echo "Ошибка: adb не найден." >&2
  exit 1
fi

# Одна команда: отключить от других устройств, подключиться к целевому.
# Здесь тоже очищаем ADB_SERVER_SOCKET, чтобы adb не пытался ходить к "левому" демону.
unset ADB_SERVER_SOCKET 2>/dev/null || true
adb disconnect &>/dev/null || true
adb connect "$ADB_TARGET" 2>/dev/null || true
sleep 1

# Установка android_id (требуется root или работа от root-оболочки в Bliss)
adb -s "$ADB_TARGET" shell "settings put secure android_id $ANDROID_ID" 2>/dev/null || {
  echo "Предупреждение: settings put может требовать root. Попробуйте: adb root && adb shell settings put secure android_id $ANDROID_ID" >&2
}

echo "ANDROID_ID=$ANDROID_ID"
echo "Установлен android_id для $ADB_TARGET"
