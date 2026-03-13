#!/usr/bin/env bash
# Генерация конфига redsocks и (опционально) загрузка на устройство через ADB.
# Использование:
#   ./apply-proxy.sh <proxy_type> <proxy_host> <proxy_port> [login] [password]  — пушить конфиг и запустить redsocks
#   ./apply-proxy.sh --run-only   — только запустить start-redsocks.sh (конфиг уже на устройстве)
#   ./apply-proxy.sh --stdout socks5 127.0.0.1 1080   — вывести конфиг в stdout
# proxy_type: socks5 | socks4 | http-connect

set -euo pipefail

RUN_ONLY=false
STDOUT=false
if [[ "${1:-}" == "--run-only" ]]; then
  RUN_ONLY=true
  shift
elif [[ "${1:-}" == "--stdout" ]]; then
  STDOUT=true
  shift
fi

if [[ "$RUN_ONLY" == true ]]; then
  ADB_TARGET="${ADB_TARGET:?При --run-only нужна переменная ADB_TARGET}"
  if command -v adb &>/dev/null; then
    echo "Запуск redsocks на $ADB_TARGET..."
    if adb -s "$ADB_TARGET" shell "su -c '/data/local/tmp/start-redsocks.sh'" 2>/dev/null; then
      echo "Прокси применён (redsocks запущен)."
    else
      echo "Запуск start-redsocks.sh не удался (скрипт и бинарь redsocks должны быть в /data/local/tmp/ на устройстве, например загружены в шаблон VM)." >&2
      exit 1
    fi
  else
    echo "adb не найден." >&2
    exit 1
  fi
  exit 0
fi

PROXY_TYPE="${1:?Usage: $0 [--stdout|--run-only] <socks5|socks4|http-connect> <host> <port> [login] [password]}"
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
  local_ip = 0.0.0.0;
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
  if ! adb -s "$ADB_TARGET" push "$CONF_FILE" /data/local/tmp/redsocks.conf 2>&1; then
    if ! adb -s "$ADB_TARGET" push "$CONF_FILE" /sdcard/redsocks.conf 2>&1; then
      echo "Не удалось загрузить конфиг на устройство. Убедитесь, что VM запущена и доступна по ADB (adb connect $ADB_TARGET). Положите redsocks.conf вручную при необходимости." >&2
      echo "Содержимое конфига:"
      cat "$CONF_FILE"
      exit 1
    fi
  fi
  echo "Конфиг загружен на $ADB_TARGET. Запуск redsocks на устройстве..."
  if adb -s "$ADB_TARGET" shell "su -c '/data/local/tmp/start-redsocks.sh'" 2>/dev/null; then
    echo "Прокси применён (redsocks запущен)."
  else
    echo "Запуск start-redsocks.sh на устройстве не удался (скрипт и redsocks должны быть в шаблоне VM в /data/local/tmp/). Трафик пойдёт через прокси после ручного запуска или перезагрузки VM." >&2
  fi
else
  echo "Конфиг redsocks (сохраните в /etc/redsocks.conf или передайте на VM вручную):"
  cat "$CONF_FILE"
fi
