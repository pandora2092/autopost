#!/usr/bin/env bash
# Установка APK YouTube на устройство через ADB.
# По аналогии с install-instagram.sh: путь к APK через YOUTUBE_APK или второй аргумент.
#
# Использование:
#   ./install-youtube.sh <adb_target> [apk_path_or_dir]
#

set -euo pipefail

ADB_TARGET="${1:?Usage: $0 <adb_target> [apk_path_or_dir]}"
APK_PATH="${2:-${YOUTUBE_APK:-}}"

if [[ -z "${APK_PATH}" ]]; then
  echo "Ошибка: не указан путь к APK или каталог. Передайте вторым аргументом или задайте переменную окружения YOUTUBE_APK." >&2
  exit 1
fi

if [[ ! -f "${APK_PATH}" && ! -d "${APK_PATH}" ]]; then
  echo "Ошибка: не найден файл или каталог: ${APK_PATH}" >&2
  exit 1
fi

if ! command -v adb &>/dev/null; then
  echo "Ошибка: adb не найден." >&2
  exit 1
fi

unset ADB_SERVER_SOCKET 2>/dev/null || true
adb disconnect &>/dev/null || true
adb connect "${ADB_TARGET}" 2>/dev/null || true
sleep 1

YOUTUBE_PKG="com.google.android.youtube"
INSTALL_OUT=$(mktemp)
trap 'rm -f "$INSTALL_OUT"' EXIT

if [[ -d "${APK_PATH}" ]]; then
  BASE_APK="${APK_PATH}/base.apk"
  if [[ ! -f "$BASE_APK" ]]; then
    echo "Ошибка: в каталоге ${APK_PATH} нет base.apk" >&2
    exit 1
  fi
  APK_FILES=("$BASE_APK")
  for f in "${APK_PATH}"/*.apk; do
    [[ -f "$f" && "$(basename "$f")" != "base.apk" ]] && APK_FILES+=("$f")
  done
  USE_INSTALL_MULTIPLE=1
  echo "Установка YouTube (bundle: ${#APK_FILES[@]} APK) из ${APK_PATH} на ${ADB_TARGET}..."
else
  APK_FILES=("${APK_PATH}")
  USE_INSTALL_MULTIPLE=0
  echo "Установка YouTube из ${APK_PATH} на ${ADB_TARGET}..."
fi

do_install() {
  if (( USE_INSTALL_MULTIPLE )); then
    adb -s "${ADB_TARGET}" install-multiple "${APK_FILES[@]}"
  else
    adb -s "${ADB_TARGET}" install -r "${APK_FILES[0]}"
  fi
}

set +e
do_install 2>&1 | tee "$INSTALL_OUT"
ADB_EXIT=${PIPESTATUS[0]}
set -e
if [[ $ADB_EXIT -ne 0 ]]; then
  if grep -q "INSTALL_FAILED_VERIFICATION_FAILURE" "$INSTALL_OUT"; then
    echo "Ошибка проверки подписи. Удаляю предыдущую версию (если есть) и ставлю заново..."
    adb -s "${ADB_TARGET}" uninstall "${YOUTUBE_PKG}" 2>/dev/null || true
    set +e
    if (( USE_INSTALL_MULTIPLE )); then
      adb -s "${ADB_TARGET}" install-multiple "${APK_FILES[@]}" 2>&1 | tee "$INSTALL_OUT"
    else
      adb -s "${ADB_TARGET}" install "${APK_FILES[0]}" 2>&1 | tee "$INSTALL_OUT"
    fi
    ADB_EXIT=${PIPESTATUS[0]}
    set -e
    if [[ $ADB_EXIT -ne 0 ]]; then
      cat "$INSTALL_OUT" >&2
      exit 1
    fi
  else
    cat "$INSTALL_OUT" >&2
    exit 1
  fi
fi

echo "Выдача разрешений для ${YOUTUBE_PKG}..."
for perm in \
  android.permission.READ_EXTERNAL_STORAGE \
  android.permission.WRITE_EXTERNAL_STORAGE \
  android.permission.CAMERA \
  android.permission.RECORD_AUDIO \
  android.permission.ACCESS_FINE_LOCATION \
  android.permission.READ_MEDIA_IMAGES \
  android.permission.READ_MEDIA_VIDEO \
  ; do
  adb -s "${ADB_TARGET}" shell pm grant "${YOUTUBE_PKG}" "${perm}" 2>/dev/null || true
done

echo "YOUTUBE_APK=${APK_PATH}"
echo "YOUTUBE_INSTALLED=1"
echo "YouTube установлен для ${ADB_TARGET}"
