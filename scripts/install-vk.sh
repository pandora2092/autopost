#!/usr/bin/env bash
# Установка APK VK (ВКонтакте) на устройство через ADB.
# Поддержка одного APK или split bundle: каталог с базовым APK (например VK-8.170.apk) и config.*.apk.
# Путь: VK_APK или второй аргумент.
#
# Использование:
#   ./install-vk.sh <adb_target> [apk_path_or_dir]
#

set -euo pipefail

ADB_TARGET="${1:?Usage: $0 <adb_target> [apk_path_or_dir]}"
APK_PATH="${2:-${VK_APK:-}}"

if [[ -z "${APK_PATH}" ]]; then
  echo "Ошибка: не указан путь к APK или каталог. Передайте вторым аргументом или задайте переменную окружения VK_APK." >&2
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

VK_PKG="com.vkontakte.android"
INSTALL_OUT=$(mktemp)
trap 'rm -f "$INSTALL_OUT"' EXIT

if [[ -d "${APK_PATH}" ]]; then
  mapfile -t ALL_APK < <(find "${APK_PATH}" -maxdepth 1 -name '*.apk' -type f | sort)
  if [[ ${#ALL_APK[@]} -eq 0 ]]; then
    echo "Ошибка: в каталоге ${APK_PATH} нет .apk файлов" >&2
    exit 1
  fi
  BASE=""
  for f in "${ALL_APK[@]}"; do
    bn=$(basename "$f")
    if [[ "$bn" == config.*.apk ]]; then
      continue
    fi
    BASE="$f"
    break
  done
  if [[ -z "${BASE}" ]]; then
    BASE="${ALL_APK[0]}"
  fi
  APK_FILES=("${BASE}")
  for f in "${ALL_APK[@]}"; do
    [[ "$f" == "${BASE}" ]] && continue
    APK_FILES+=("$f")
  done
  USE_INSTALL_MULTIPLE=1
  echo "Установка VK (split: ${#APK_FILES[@]} APK) из ${APK_PATH} на ${ADB_TARGET}..."
else
  APK_FILES=("${APK_PATH}")
  USE_INSTALL_MULTIPLE=0
  echo "Установка VK из ${APK_PATH} на ${ADB_TARGET}..."
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
    adb -s "${ADB_TARGET}" uninstall "${VK_PKG}" 2>/dev/null || true
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

echo "Выдача разрешений для ${VK_PKG}..."
for perm in \
  android.permission.READ_EXTERNAL_STORAGE \
  android.permission.WRITE_EXTERNAL_STORAGE \
  android.permission.CAMERA \
  android.permission.RECORD_AUDIO \
  android.permission.ACCESS_FINE_LOCATION \
  android.permission.READ_MEDIA_IMAGES \
  android.permission.READ_MEDIA_VIDEO \
  ; do
  adb -s "${ADB_TARGET}" shell pm grant "${VK_PKG}" "${perm}" 2>/dev/null || true
done

echo "VK_APK=${APK_PATH}"
echo "VK_INSTALLED=1"
echo "VK установлен для ${ADB_TARGET}"
