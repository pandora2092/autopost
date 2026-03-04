#!/usr/bin/env bash
# Сброс редиректа трафика через redsocks на устройстве (очистка iptables nat).
# После выполнения трафик из браузера и приложений идёт напрямую, без прокси.
# Использование: ./disable-proxy-on-device.sh <adb_target>
# adb_target: IP:5555 или serial (например 192.168.122.5:5555).
# Требуется root на устройстве (su).

set -euo pipefail

ADB_TARGET="${1:?Usage: $0 <adb_target>}"

# Очищаем цепочку OUTPUT в таблице nat (туда обычно вешают REDIRECT на redsocks)
# Варианты вызова: su -c (Magisk/root) или без su если adb root доступен
run_iptables() {
  adb -s "$ADB_TARGET" shell "su -c 'iptables -t nat -F OUTPUT'" 2>/dev/null || \
  adb -s "$ADB_TARGET" shell "iptables -t nat -F OUTPUT" 2>/dev/null || \
  adb -s "$ADB_TARGET" shell "su 0 iptables -t nat -F OUTPUT" 2>/dev/null
}

if run_iptables; then
  echo "Правила nat OUTPUT сброшены. Трафик больше не редиректится в redsocks."
else
  echo "Не удалось выполнить iptables (нужен root на устройстве). Попробуйте вручную в adb shell: iptables -t nat -F OUTPUT" >&2
  exit 1
fi
