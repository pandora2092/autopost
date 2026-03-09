#!/usr/bin/env bash
# Установка APK Instagram на устройство через ADB.
# После установки выдаёт runtime-разрешения (storage, camera и др.), иначе в App info будет "No permissions granted".
# Безопасный вариант: шаблон VM остаётся «чистым», а приложение ставится
# индивидуально для каждой VM по её ADB-адресу.
#
# Использование:
#   ./install-instagram.sh <adb_target> [apk_path_or_dir]
#   adb_target: IP:port (например 192.168.122.5:5555) или serial.
#   apk_path_or_dir: один APK или каталог с bundle (base.apk + split_*.apk). По умолчанию $INSTAGRAM_APK.
#
# Примеры:
#   INSTAGRAM_APK=/opt/apk/instagram.apk ./install-instagram.sh 192.168.122.5:5555
#   INSTAGRAM_APK=/opt/apk/instagram-bundle ./install-instagram.sh 192.168.122.5:5555   # каталог с base.apk и split_*.apk
#

set -euo pipefail

ADB_TARGET="${1:?Usage: $0 <adb_target> [apk_path_or_dir]}"
APK_PATH="${2:-${INSTAGRAM_APK:-}}"

if [[ -z "${APK_PATH}" ]]; then
  echo "Ошибка: не указан путь к APK или каталог. Передайте вторым аргументом или задайте переменную окружения INSTAGRAM_APK." >&2
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

# Отключиться от прочих устройств и подключиться к целевому.
# Важно: убираем ADB_SERVER_SOCKET, чтобы adb точно запускался локально,
# иначе при странных значениях переменной возможна ошибка "unknown socket specification".
unset ADB_SERVER_SOCKET 2>/dev/null || true
adb disconnect &>/dev/null || true
adb connect "${ADB_TARGET}" 2>/dev/null || true
sleep 1

INSTAGRAM_PKG="com.instagram.android"
INSTALL_OUT=$(mktemp)
trap 'rm -f "$INSTALL_OUT"' EXIT

# Один APK или bundle (каталог с base.apk и split_*.apk)
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
  echo "Установка Instagram (bundle: ${#APK_FILES[@]} APK) из ${APK_PATH} на ${ADB_TARGET}..."
else
  APK_FILES=("${APK_PATH}")
  USE_INSTALL_MULTIPLE=0
  echo "Установка Instagram из ${APK_PATH} на ${ADB_TARGET}..."
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
    adb -s "${ADB_TARGET}" uninstall "${INSTAGRAM_PKG}" 2>/dev/null || true
    set +e
    if (( USE_INSTALL_MULTIPLE )); then
      adb -s "${ADB_TARGET}" install-multiple "${APK_FILES[@]}" 2>&1 | tee "$INSTALL_OUT"
    else
      adb -s "${ADB_TARGET}" install "${APK_FILES[0]}" 2>&1 | tee "$INSTALL_OUT"
    fi
    ADB_EXIT=${PIPESTATUS[0]}
    set -e
    if [[ $ADB_EXIT -ne 0 ]]; then
      if grep -q "INSTALL_FAILED_VERIFICATION_FAILURE" "$INSTALL_OUT" 2>/dev/null; then
        echo "" >&2
        echo "Установка заблокирована проверкой на устройстве (часто при первой установке)." >&2
        echo "На VM отключите: Настройки → Google → Безопасность → Защита Play (Play Protect)," >&2
        echo "или: Настройки → Безопасность → «Проверка приложений» / Verify apps." >&2
        echo "После отключения снова нажмите «Установить Instagram»." >&2
      fi
      cat "$INSTALL_OUT" >&2
      exit 1
    fi
  else
    cat "$INSTALL_OUT" >&2
    exit 1
  fi
fi

# Выдать runtime-разрешения (при установке через adb они не выдаются; без этого в App info будет "No permissions granted")
echo "Выдача разрешений для ${INSTAGRAM_PKG}..."
for perm in \
  android.permission.READ_EXTERNAL_STORAGE \
  android.permission.WRITE_EXTERNAL_STORAGE \
  android.permission.CAMERA \
  android.permission.RECORD_AUDIO \
  android.permission.ACCESS_FINE_LOCATION \
  android.permission.READ_MEDIA_IMAGES \
  android.permission.READ_MEDIA_VIDEO \
  ; do
  adb -s "${ADB_TARGET}" shell pm grant "${INSTAGRAM_PKG}" "${perm}" 2>/dev/null || true
done

# SoLoader при первом запуске создаёт lib-main и dso_lock; на части android-x86 из-за прав/SELinux падает с FileNotFoundException.
# Заранее создаём каталог с владельцем приложения (нужен adb root на устройстве).
if adb -s "${ADB_TARGET}" root 2>/dev/null; then
  sleep 1
  APP_UID=$(adb -s "${ADB_TARGET}" shell "stat -c '%u' /data/data/${INSTAGRAM_PKG} 2>/dev/null" | tr -d '\r')
  if [[ -n "${APP_UID}" ]]; then
    adb -s "${ADB_TARGET}" shell "mkdir -p /data/data/${INSTAGRAM_PKG}/lib-main && chown ${APP_UID}:${APP_UID} /data/data/${INSTAGRAM_PKG}/lib-main" 2>/dev/null && echo "Создан каталог lib-main для SoLoader." || true
  fi
fi

echo "INSTAGRAM_APK=${APK_PATH}"
echo "INSTAGRAM_INSTALLED=1"
echo "Instagram установлен для ${ADB_TARGET}"
echo ""
echo "Если приложение при запуске падает (SoLoader/dso_lock, Dalvik cache):"
echo "  1. На устройстве с root: adb -s ${ADB_TARGET} shell setenforce 0  (временно отключить SELinux для проверки)."
echo "  2. Удалить данные приложения: Настройки → Приложения → Instagram → Очистить данные, затем запустить снова."

