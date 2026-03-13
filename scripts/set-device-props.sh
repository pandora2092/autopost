#!/usr/bin/env bash
# Подмена ro.product.manufacturer и ro.product.model на устройстве (чтобы не светить QEMU/эмулятор).
# Вызывается при «Настроить конфигурацию». Требуется root в VM.
#
# Использование: ./set-device-props.sh <adb_target> [manufacturer] [model]
# По умолчанию: manufacturer=Samsung, model=SM-G973F (или из env DEVICE_PROP_MANUFACTURER, DEVICE_PROP_MODEL).

set -euo pipefail

ADB_TARGET="${1:?Usage: $0 <adb_target> [manufacturer] [model]}"
MANUFACTURER="${2:-${DEVICE_PROP_MANUFACTURER:-Samsung}}"
MODEL="${3:-${DEVICE_PROP_MODEL:-SM-G973F}}"

if ! command -v adb &>/dev/null; then
  echo "Ошибка: adb не найден." >&2
  exit 1
fi

unset ADB_SERVER_SOCKET 2>/dev/null || true
adb disconnect &>/dev/null || true
adb connect "${ADB_TARGET}" 2>/dev/null || true
sleep 1

# Экранируем для sed: / и & (значения подставляются на хосте)
MANUF_ESC=$(echo "$MANUFACTURER" | sed 's/[\/&]/\\&/g')
MODEL_ESC=$(echo "$MODEL" | sed 's/[\/&]/\\&/g')

# Запись в /system требует root — выполняем через su -c
adb -s "${ADB_TARGET}" shell "su -c \"mount -o rw,remount /system 2>/dev/null || true\""
adb -s "${ADB_TARGET}" shell "su -c \"grep -q '^ro.product.manufacturer=' /system/build.prop 2>/dev/null && sed -i 's/^ro.product.manufacturer=.*/ro.product.manufacturer=${MANUF_ESC}/' /system/build.prop || echo 'ro.product.manufacturer=${MANUF_ESC}' >> /system/build.prop\""
adb -s "${ADB_TARGET}" shell "su -c \"grep -q '^ro.product.model=' /system/build.prop 2>/dev/null && sed -i 's/^ro.product.model=.*/ro.product.model=${MODEL_ESC}/' /system/build.prop || echo 'ro.product.model=${MODEL_ESC}' >> /system/build.prop\""
adb -s "${ADB_TARGET}" shell "su -c \"grep -q '^ro.product.brand=' /system/build.prop 2>/dev/null && sed -i 's/^ro.product.brand=.*/ro.product.brand=${MANUF_ESC}/' /system/build.prop || true\""
adb -s "${ADB_TARGET}" shell "su -c \"mount -o ro,remount /system 2>/dev/null || true\""

echo "DEVICE_PROPS_SET=1"
echo "На устройство ${ADB_TARGET} установлены ro.product.manufacturer=${MANUFACTURER}, ro.product.model=${MODEL}. Перезагрузите VM, чтобы приложения увидели изменения."
echo "Рекомендуется: adb -s ${ADB_TARGET} shell reboot"
