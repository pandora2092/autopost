#!/system/bin/sh

CONF="/data/local/tmp/redsocks.conf"
REDSOCKS="/data/local/tmp/redsocks"
PORT=12345

# Проверка конфигурации
if [ ! -f "$CONF" ]; then
  echo "No $CONF, skip proxy"
  exit 0
fi

# Парсим IP и PORT прокси
PROXY_IP=$(grep 'ip =' "$CONF" | head -n1 | sed 's/.*= *//;s/;//')
PROXY_PORT=$(grep 'port =' "$CONF" | grep -v local | head -n1 | sed 's/.*= *//;s/;//')

# Очистка старых правил
iptables -t nat -F OUTPUT 2>/dev/null
iptables -t nat -D OUTPUT -p tcp -j REDSOCKS 2>/dev/null
iptables -t nat -X REDSOCKS 2>/dev/null

# Создаем цепочку REDSOCKS
iptables -t nat -N REDSOCKS

# Исключаем localhost и прокси
iptables -t nat -A REDSOCKS -p tcp -d 127.0.0.0/8 -j RETURN
iptables -t nat -A REDSOCKS -p tcp -d "$PROXY_IP" --dport "$PROXY_PORT" -j RETURN

# Перехватываем всё остальное, кроме root
iptables -t nat -A REDSOCKS -p tcp -m owner ! --uid-owner 0 -j REDIRECT --to-ports "$PORT"

# Применяем цепочку
iptables -t nat -A OUTPUT -p tcp -j REDSOCKS

# Убиваем старый redsocks
killall redsocks 2>/dev/null
sleep 1

# Запуск redsocks
if [ -x "$REDSOCKS" ]; then
  $REDSOCKS -c "$CONF"
else
  echo "redsocks binary not found: $REDSOCKS"
  exit 1
fi
