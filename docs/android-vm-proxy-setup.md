# Пошаговая настройка прокси на Android VM

Чтобы каждая VM выходила в интернет через свой прокси (который задаётся в панели), на образе Android нужно **один раз** установить redsocks и скрипт запуска. Конфиг загружается на устройство при нажатии «Узнать IP». Дальше панель только запускает redsocks при старте VM и перед публикацией постов.

---

## Что понадобится

- **Root** на устройстве (для iptables и запуска redsocks).
- **ADB** по сети (порт 5555), чтобы панель могла пушить конфиг и запускать скрипт.
- **Архитектура образа**: x86, x86_64, arm или arm64 — под неё нужен свой бинарь redsocks.

---

## Шаг 1. Узнать архитектуру Android

На хосте (когда VM уже запущена и доступна по ADB):

```bash
adb -s 192.168.122.5:5555 shell getprop ro.product.cpu.abi
```

Будет что-то вроде `x86_64`, `x86`, `arm64-v8a` или `armeabi-v7a`. Запомните для шага 2.

---

## Шаг 2. Получить бинарь redsocks

### Вариант A: Готовый бинарь

Найти сборку redsocks под вашу архитектуру (Termux, Magisk-модули, сторонние репозитории). Файл должен называться `redsocks` (без расширения), архитектура — как в шаге 1.

### Вариант B: Сборка из исходников

Репозиторий: https://github.com/darkk/redsocks  

Нужна кросс-компиляция под Android (NDK):

```bash
# Установить Android NDK, затем:
git clone https://github.com/darkk/redsocks.git
cd redsocks
# В Makefile задать CC из NDK и целевую triple, например:
# для x86_64:  -target x86_64-linux-android
# для arm64:   -target aarch64-linux-android
make
```

Получится исполняемый файл `redsocks`.

---

## Шаг 3. Положить redsocks на устройство

С хоста (подставьте свой IP:порт ADB, например `192.168.122.5:5555`):

```bash
adb -s 192.168.122.5:5555 push /путь/к/redsocks /data/local/tmp/redsocks
adb -s 192.168.122.5:5555 shell su -c "chmod 755 /data/local/tmp/redsocks"
или
adb -s 192.168.122.157:5555 shell "su -c 'chmod 755 /data/local/tmp/redsocks'"
```

Проверка:

```bash
adb -s 192.168.122.157:5555 shell "/data/local/tmp/redsocks -h"
```

Должна вывести справку по аргументам (или хотя бы не «not found»).

---

## Шаг 4. Создать скрипт запуска на хосте

Создайте файл `start-redsocks.sh` (например в `scripts/` или у себя в домашней папке) с таким содержимым:

```bash
#!/system/bin/sh
# Запуск redsocks и настройка iptables. Конфиг: /data/local/tmp/redsocks.conf

CONF="/data/local/tmp/redsocks.conf"
REDSOCKS="/data/local/tmp/redsocks"
PORT=12345

if [ ! -f "$CONF" ]; then
  echo "No $CONF, skip proxy"
  exit 0
fi

# Достать IP и порт прокси из конфига (строки ip = ...; port = ...;)
PROXY_IP=$(grep -E '^\s*ip\s*=' "$CONF" | sed 's/.*=\s*\([^;]*\).*/\1/' | tr -d ' ')
PROXY_PORT=$(grep -E '^\s*port\s*=' "$CONF" | sed 's/.*=\s*\([0-9]*\).*/\1/' | tr -d ' ')

# Если это домен — разрешить в IP
if echo "$PROXY_IP" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$'; then
  :
else
  PROXY_IP=$(getent hosts "$PROXY_IP" 2>/dev/null | awk '{print $1; exit}')
  [ -z "$PROXY_IP" ] && PROXY_IP=$(nslookup "$PROXY_IP" 2>/dev/null | awk '/^Address: / {print $2; exit}')
fi

# Сброс старых правил редиректа в nat OUTPUT
iptables -t nat -F OUTPUT 2>/dev/null

if [ -n "$PROXY_IP" ] && [ -n "$PROXY_PORT" ]; then
  iptables -t nat -A OUTPUT -p tcp -d 127.0.0.0/8 -j RETURN
  iptables -t nat -A OUTPUT -p tcp -d "$PROXY_IP" --dport "$PROXY_PORT" -j RETURN
  iptables -t nat -A OUTPUT -p tcp -j REDIRECT --to-ports "$PORT"
fi

# Убить старый redsocks, если был
killall redsocks 2>/dev/null
sleep 1

# Запуск redsocks с конфигом
if [ -x "$REDSOCKS" ]; then
  $REDSOCKS -c "$CONF"
else
  echo "redsocks binary not found: $REDSOCKS"
  exit 1
fi
```

Сохраните файл и запомните путь к нему.

---

## Шаг 5. Загрузить скрипт на устройство

С хоста:

```bash
adb -s 192.168.122.157:5555 push /путь/к/start-redsocks.sh /data/local/tmp/start-redsocks.sh
adb -s 192.168.122.157:5555 shell "su -c 'chmod 755 /data/local/tmp/start-redsocks.sh'"
```

Проверка (конфига ещё нет — скрипт должен просто выйти с «No ... skip proxy»):

```bash
adb -s 192.168.122.157:5555 shell "su -c '/data/local/tmp/start-redsocks.sh'"
```

Ожидаемый вывод: `No /data/local/tmp/redsocks.conf, skip proxy`.

---

## Шаг 6. Проверить применение прокси с панели

1. В панели создайте прокси (хост, порт, при необходимости логин/пароль).
2. Создайте или отредактируйте VM и привяжите к ней этот прокси.
3. Запустите VM («Старт»).
4. Нажмите «Узнать IP» — бэкенд загрузит `redsocks.conf` на устройство (один раз) и запустит redsocks.
5. При следующих запусках VM («Старт») и перед публикацией постов бэкенд лишь запускает redsocks (конфиг уже на устройстве и не перезаписывается).

Если скрипт и redsocks на месте, трафик VM пойдёт через прокси без ручных действий.

Проверка с хоста (должны быть правила REDIRECT и RETURN для прокси):

```bash
adb -s 192.168.122.5:5555 shell "su -c 'iptables -t nat -L OUTPUT -n -v'"
```

В браузере внутри VM откройте любой внешний сайт и при необходимости проверьте логи/статистику на стороне прокси.

---

## Шаг 7 (по желанию). Автозапуск при загрузке Android

Если хотите, чтобы после перезагрузки VM прокси поднимался сам (конфиг панель подложит при следующем «Старт» или «Применить прокси»):

### С Magisk

- Скопируйте `start-redsocks.sh` в `/data/adb/service.d/` на устройстве (через `adb push` в эту папку с root).
- Magisk при загрузке выполнит скрипты из этой папки с root.
- При первом boot конфига может ещё не быть — скрипт тогда просто выйдет (exit 0). После того как панель применит прокси, redsocks поднимется при следующем запуске скрипта (при «Старт» или «Применить прокси» панель сама вызывает скрипт по ADB).

### Без Magisk

После каждой перезагрузки VM либо снова нажмите «Старт» в панели (конфиг подложится и скрипт запустится), либо вручную:

```bash
adb -s IP:5555 shell "su -c '/data/local/tmp/start-redsocks.sh'"
```

---

## Краткая сводка

| Что | Где на устройстве |
|-----|--------------------|
| Бинарь redsocks | `/data/local/tmp/redsocks` (chmod 755) |
| Скрипт запуска | `/data/local/tmp/start-redsocks.sh` (chmod 755) |
| Конфиг | `/data/local/tmp/redsocks.conf` — загружается **один раз** при нажатии «Узнать IP» |

**Поведение:**
- **«Узнать IP»** — загружает конфиг на устройство и запускает redsocks.
- **«Старт» VM** — только запускает redsocks (конфиг уже на устройстве).
- **Перед публикацией поста** — только запускает redsocks.

---

## Отключение прокси

Временно отключить редирект (трафик пойдёт напрямую):

```bash
adb -s IP:5555 shell "su -c 'iptables -t nat -F OUTPUT'"
adb -s IP:5555 shell "su -c 'killall redsocks'"
```

Либо со хоста:

```bash
./scripts/disable-proxy-on-device.sh IP:5555
```
