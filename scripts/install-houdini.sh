#!/usr/bin/env bash
# Установка ARM-translation (Houdini) на Android-x86 для запуска ARM-приложений (Instagram и др.).
#
# Использование:
#   ./install-houdini.sh <adb_target>
#   adb_target: IP:port (например 192.168.122.5:5555)
#
# Требования: VM с Android-x86 9.0, adb на хосте, root-доступ в VM.
#
# Уже скачали houdini9_y.sfs? Укажите путь (скрипт не будет качать из сети):
#   HOUDINI_SFS_FILE=/path/to/houdini9_y.sfs ./install-houdini.sh 192.168.122.5:5555
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

HOUDINI_SRC=""
if [[ -n "${HOUDINI_SFS_FILE:-}" && -f "${HOUDINI_SFS_FILE}" ]]; then
  HOUDINI_SRC="${HOUDINI_SFS_FILE}"
  echo "Использую локальный файл: ${HOUDINI_SRC}"
elif [[ -f "${HOUDINI_CACHE}/${HOUDINI_SFS}" ]]; then
  HOUDINI_SRC="${HOUDINI_CACHE}/${HOUDINI_SFS}"
fi

# Скачать houdini.sfs, если ещё нет
if [[ -z "${HOUDINI_SRC}" ]]; then
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

if [[ -z "${HOUDINI_SRC}" ]]; then
  if [[ -f "${HOUDINI_CACHE}/${HOUDINI_SFS}" ]]; then
    HOUDINI_SRC="${HOUDINI_CACHE}/${HOUDINI_SFS}"
  fi
fi

if [[ -z "${HOUDINI_SRC}" || ! -f "${HOUDINI_SRC}" ]]; then
  echo "Ошибка: файл Houdini не найден."
  echo ""
  echo "Скачайте вручную:"
  echo "  1. http://dl.android-x86.org/houdini/9_y/houdini.sfs"
  echo "  2. Или с https://aopc.dev/r/houdini-arm-translation.108/ (Houdini для Android x86 9.0)"
  echo ""
  echo "Положите в: ${HOUDINI_CACHE}/${HOUDINI_SFS}"
  echo "Или передайте путь: HOUDINI_SFS_FILE=/полный/путь/houdini9_y.sfs $0 ${ADB_TARGET}"
  exit 1
fi

# Подключение по ADB
unset ADB_SERVER_SOCKET 2>/dev/null || true
adb disconnect &>/dev/null || true
adb connect "${ADB_TARGET}" 2>/dev/null || true
sleep 2

echo "Установка Houdini на ${ADB_TARGET}..."

# Отправить файл во временную папку
echo "→ adb push (файл на устройство)…"
adb -s "${ADB_TARGET}" push "${HOUDINI_SRC}" /data/local/tmp/"${HOUDINI_SFS}"

# adbd в режиме root (иначе cp в /system может молча не сработать)
echo "→ adb root (перезапуск adbd, подождите)…"
adb -s "${ADB_TARGET}" root 2>/dev/null || true
sleep 3
adb connect "${ADB_TARGET}" 2>/dev/null || true
sleep 1

echo "→ remount /system…"
# На Android-x86 «adb remount» часто ругается на /dev/loop0 — это не всегда значит, что /system недоступен для записи.
adb -s "${ADB_TARGET}" remount 2>/dev/null || true
adb -s "${ADB_TARGET}" shell 'mount -o rw,remount /system 2>/dev/null || mount -o rw,remount / 2>/dev/null || true'

echo "→ копирование в /system/etc/${HOUDINI_SFS}…"
if ! adb -s "${ADB_TARGET}" shell "cp /data/local/tmp/${HOUDINI_SFS} /system/etc/${HOUDINI_SFS} && echo cp_ok"; then
  echo "Ошибка: не удалось скопировать в /system/etc. Выполните шаги вручную (см. ниже)."
else
  echo ""
  echo "Если выше «remount failed» / «loop0» — на многих сборках Android-x86 это нормально; при cp_ok файл на месте."
fi

# Этот шаг часто долгий (минуты), вывода может не быть — это нормально
echo ""
echo "→ /system/bin/enable_nativebridge …"
echo "   (может занять 5–15+ минут, терминал как будто «завис» — обычно это ожидание, не прерывайте)"
echo "   Сообщения modprobe про modprobe.conf — часто безвредны в VM."
echo ""
if command -v timeout &>/dev/null; then
  # Защита от бесконечного зависания: максимум 30 минут
  timeout 1800 adb -s "${ADB_TARGET}" shell "/system/bin/enable_nativebridge" || {
    echo ""
    echo "enable_nativebridge завершился с кодом $? (или сработал timeout 30 мин)."
    echo "Если процесс всё ещё идёт на устройстве, дождитесь окончания или сделайте шаг вручную в консоли VM."
  }
else
  adb -s "${ADB_TARGET}" shell "/system/bin/enable_nativebridge" || true
fi

echo "→ удаление временного файла…"
adb -s "${ADB_TARGET}" shell "rm -f /data/local/tmp/${HOUDINI_SFS}" 2>/dev/null || true

echo ""
echo "Готово (если не было ошибок выше). Перезагрузите VM: adb -s ${ADB_TARGET} reboot"
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
