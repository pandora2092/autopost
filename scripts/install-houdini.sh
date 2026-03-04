#!/usr/bin/env bash
# Установка ARM-translation (Houdini) на Android-x86 для запуска ARM-приложений (Instagram и др.).
#
# Использование:
#   ./install-houdini.sh <adb_target>
#   adb_target: IP:port (например 192.168.122.5:5555)
#
# Требования: VM с Android-x86 9.0, adb на хосте, root-доступ в VM.
#
# Источники Houdini:
#   - dl.android-x86.org/houdini/9_y/ (x86_64, armhf)
#   - dl.android-x86.org/houdini/9_z/ (x86_64, arm64 — если доступен)
#   - aopc.dev (альтернатива, если dl.android-x86.org не отвечает)
#

set -euo pipefail

ADB_TARGET="${1:?Usage: $0 <adb_target>}"
HOUDINI_CACHE="${HOUDINI_CACHE:-$HOME/.cache/houdini-android-x86}"
HOUDINI_SFS="houdini9_y.sfs"  # 9_y для x86_64 + armhf; для arm64 — 9_z

mkdir -p "${HOUDINI_CACHE}"

# Скачать houdini.sfs, если ещё нет
if [[ ! -f "${HOUDINI_CACHE}/${HOUDINI_SFS}" ]]; then
  echo "Скачиваю Houdini (ARM-translation)..."
  for url in \
    "http://dl.android-x86.org/houdini/9_y/houdini.sfs" \
    "http://dl.android-x86.org/houdini/8_y/houdini.sfs"
  do
    if curl -fsSL -o "${HOUDINI_CACHE}/houdini.sfs" "$url" 2>/dev/null; then
      mv "${HOUDINI_CACHE}/houdini.sfs" "${HOUDINI_CACHE}/${HOUDINI_SFS}"
      echo "Скачано: ${HOUDINI_CACHE}/${HOUDINI_SFS}"
      break
    fi
  done
fi

if [[ ! -f "${HOUDINI_CACHE}/${HOUDINI_SFS}" ]]; then
  echo "Ошибка: файл Houdini не найден."
  echo ""
  echo "Скачайте вручную:"
  echo "  1. http://dl.android-x86.org/houdini/9_y/houdini.sfs"
  echo "  2. Или с https://aopc.dev/r/houdini-arm-translation.108/ (Houdini для Android x86 9.0)"
  echo ""
  echo "Положите в: ${HOUDINI_CACHE}/${HOUDINI_SFS}"
  exit 1
fi

# Подключение по ADB
unset ADB_SERVER_SOCKET 2>/dev/null || true
adb disconnect &>/dev/null || true
adb connect "${ADB_TARGET}" 2>/dev/null || true
sleep 2

echo "Установка Houdini на ${ADB_TARGET}..."

# Отправить файл во временную папку
adb -s "${ADB_TARGET}" push "${HOUDINI_CACHE}/${HOUDINI_SFS}" /data/local/tmp/

# Выполнить установку в root shell (Android-x86 обычно даёт root по умолчанию)
adb -s "${ADB_TARGET}" shell "mount -o rw,remount /system 2>/dev/null || mount -o rw,remount / 2>/dev/null; cp /data/local/tmp/${HOUDINI_SFS} /system/etc/ 2>/dev/null; /system/bin/enable_nativebridge 2>/dev/null || true; rm -f /data/local/tmp/${HOUDINI_SFS}"

echo ""
echo "Если автоустановка не сработала, сделайте вручную в root shell (Alt+F1 в VM):"
echo ""
echo "  mount -o rw,remount /system"
echo "  cp /data/local/tmp/${HOUDINI_SFS} /system/etc/"
echo "  /system/bin/enable_nativebridge"
echo "  reboot"
echo ""
echo "Или включите Native Bridge в настройках: Settings > Apps Compatibility > Enable Native Bridge"
echo ""
