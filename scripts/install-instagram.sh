#!/usr/bin/env bash
# Установка APK Instagram на устройство через ADB.
# После установки выдаёт runtime-разрешения (storage, camera и др.), иначе в App info будет "No permissions granted".
# Безопасный вариант: шаблон VM остаётся «чистым», а приложение ставится
# индивидуально для каждой VM по её ADB-адресу.
#
# Использование:
#   ./install-instagram.sh <adb_target> [apk_path]
#   adb_target: IP:port (например 192.168.122.5:5555) или serial.
#   apk_path: путь к APK Instagram. Если не указан, берётся из $INSTAGRAM_APK.
#
# Пример:
#   INSTAGRAM_APK=/opt/apk/instagram.apk ./install-instagram.sh 192.168.122.5:5555
#

set -euo pipefail

ADB_TARGET="${1:?Usage: $0 <adb_target> [apk_path]}"
APK_PATH="${2:-${INSTAGRAM_APK:-}}"

if [[ -z "${APK_PATH}" ]]; then
  echo "Ошибка: не указан путь к APK. Передайте вторым аргументом или задайте переменную окружения INSTAGRAM_APK." >&2
  exit 1
fi

if [[ ! -f "${APK_PATH}" ]]; then
  echo "Ошибка: APK не найден по пути: ${APK_PATH}" >&2
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
echo "Установка Instagram из ${APK_PATH} на ${ADB_TARGET}..."
INSTALL_OUT=$(mktemp)
trap 'rm -f "$INSTALL_OUT"' EXIT
set +e
adb -s "${ADB_TARGET}" install -r "${APK_PATH}" 2>&1 | tee "$INSTALL_OUT"
ADB_EXIT=${PIPESTATUS[0]}
set -e
if [[ $ADB_EXIT -ne 0 ]]; then
  if grep -q "INSTALL_FAILED_VERIFICATION_FAILURE" "$INSTALL_OUT"; then
    echo "Ошибка проверки подписи. Удаляю предыдущую версию (если есть) и ставлю заново..."
    adb -s "${ADB_TARGET}" uninstall "${INSTAGRAM_PKG}" 2>/dev/null || true
    set +e
    adb -s "${ADB_TARGET}" install "${APK_PATH}" 2>&1 | tee "$INSTALL_OUT"
    ADB_EXIT=${PIPESTATUS[0]}
    set -e
    if [[ $ADB_EXIT -ne 0 ]] && grep -q "INSTALL_FAILED_VERIFICATION_FAILURE" "$INSTALL_OUT"; then
      echo "" >&2
      echo "Установка заблокирована проверкой на устройстве (часто при первой установке)." >&2
      echo "На VM отключите: Настройки → Google → Безопасность → Защита Play (Play Protect)," >&2
      echo "или: Настройки → Безопасность → «Проверка приложений» / Verify apps." >&2
      echo "После отключения снова нажмите «Установить Instagram»." >&2
      exit 1
    fi
    if [[ $ADB_EXIT -ne 0 ]]; then
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

