#!/usr/bin/env bash
# Устанавливает уникальный build fingerprint на устройстве (через ADB).
# Каждый клон VM должен вызываться один раз после создания, чтобы отличаться от других.
#
# Использование: ./set-build-fingerprint.sh <adb_target>
# Пример: ./set-build-fingerprint.sh 192.168.122.5:5555
#
# Меняет ro.build.display.id и ro.build.id, добавляя случайный суффикс.
# Требуется root в VM (adb root или root shell).

set -euo pipefail

ADB_TARGET="${1:?Usage: $0 <adb_target>}"

# Случайный суффикс 8 hex-символов (без пайпа через head, иначе tr получает SIGPIPE и скрипт падает с 141)
SUFFIX=$(head -c 4 /dev/urandom | xxd -p | tr -d '\n')

if ! command -v adb &>/dev/null; then
  echo "Ошибка: adb не найден." >&2
  exit 1
fi

unset ADB_SERVER_SOCKET 2>/dev/null || true
adb disconnect &>/dev/null || true
adb connect "${ADB_TARGET}" 2>/dev/null || true
sleep 1

# Меняем build.prop на устройстве: добавляем суффикс к display.id, id и fingerprint
adb -s "${ADB_TARGET}" shell "mount -o rw,remount /system 2>/dev/null || true"
adb -s "${ADB_TARGET}" shell "grep -q '^ro.build.display.id=' /system/build.prop 2>/dev/null && sed -i 's/^ro.build.display.id=.*/ro.build.display.id=android-x86_64-9.0-r2-${SUFFIX}/' /system/build.prop || true"
adb -s "${ADB_TARGET}" shell "grep -q '^ro.build.id=' /system/build.prop 2>/dev/null && sed -i 's/^ro.build.id=.*/ro.build.id=PQ3A.${SUFFIX}/' /system/build.prop || true"
adb -s "${ADB_TARGET}" shell "grep -q '^ro.build.fingerprint=' /system/build.prop 2>/dev/null && sed -i 's/^ro.build.fingerprint=.*/ro.build.fingerprint=android-x86\/generic_x86_64\/x86_64:9\/PQ3A.${SUFFIX}\/${SUFFIX}:userdebug\/test-keys/' /system/build.prop || true"
adb -s "${ADB_TARGET}" shell "mount -o ro,remount /system 2>/dev/null || true"

echo "BUILD_FINGERPRINT_SUFFIX=${SUFFIX}"
echo "На устройство ${ADB_TARGET} установлен уникальный суффикс отпечатка. Перезагрузите VM, чтобы изменения применились."
echo "Рекомендуется выполнить: adb -s ${ADB_TARGET} shell reboot"
