#!/usr/bin/env bash
# Генерация конфига redsocks и (опционально) загрузка на устройство через ADB.
# Использование: ./apply-proxy.sh <proxy_type> <proxy_host> <proxy_port> [login] [password]
# Или для вывода только конфига: ./apply-proxy.sh --stdout socks5 127.0.0.1 1080
# proxy_type: socks5 | socks4 | http-connect

set -euo pipefail

STDOUT=false
if [[ "${1:-}" == "--stdout" ]]; then
  STDOUT=true
  shift
fi

PROXY_TYPE="${1:?Usage: $0 [--stdout] <socks5|socks4|http-connect> <host> <port> [login] [password]}"
PROXY_HOST="${2:?}"
PROXY_PORT="${3:?}"
PROXY_LOGIN="${4:-}"
PROXY_PASSWORD="${5:-}"
ADB_TARGET="${ADB_TARGET:-}"

case "$PROXY_TYPE" in
  socks5|socks4|http-connect) ;;
  *) echo "Тип прокси: socks5, socks4 или http-connect." >&2; exit 1 ;;
esac

REDSOCKS_CONF="base {
  log_debug = off;
  log_info = on;
  daemon = off;
  redirector = iptables;
}
redsocks {
  local_ip = 127.0.0.1;
  local_port = 12345;
  type = $PROXY_TYPE;
  ip = $PROXY_HOST;
  port = $PROXY_PORT;
"
if [[ -n "$PROXY_LOGIN" ]]; then
  REDSOCKS_CONF+="  login = $PROXY_LOGIN;
  password = $PROXY_PASSWORD;
"
fi
REDSOCKS_CONF+="}
"

if [[ "$STDOUT" == true ]]; then
  echo "$REDSOCKS_CONF"
  exit 0
fi

# Записать конфиг в файл и при наличии ADB_TARGET — отправить на устройство
CONF_FILE=$(mktemp)
trap 'rm -f "$CONF_FILE"' EXIT
echo "$REDSOCKS_CONF" > "$CONF_FILE"

if [[ -n "$ADB_TARGET" ]] && command -v adb &>/dev/null; then
  adb -s "$ADB_TARGET" push "$CONF_FILE" /data/local/tmp/redsocks.conf 2>/dev/null || \
  adb -s "$ADB_TARGET" push "$CONF_FILE" /sdcard/redsocks.conf 2>/dev/null || {
    echo "Не удалось загрузить конфиг на устройство. Положите redsocks.conf вручную." >&2
    echo "Содержимое конфига:"
    cat "$CONF_FILE"
    exit 1
  }
  echo "Конфиг загружен на $ADB_TARGET ( /data/local/tmp/redsocks.conf или /sdcard/redsocks.conf ). Перезапустите redsocks на устройстве с этим конфигом."
else
  echo "Конфиг redsocks (сохраните в /etc/redsocks.conf или передайте на VM вручную):"
  cat "$CONF_FILE"
fi
