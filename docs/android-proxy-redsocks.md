# Прокси на Android-образе: redsocks + iptables

Чтобы весь трафик VM (браузер, приложения) шёл через прокси, на образе нужно один раз настроить **redsocks** и **iptables**. Конфиг (`redsocks.conf`) панель подкладывает сама при старте VM через `apply-proxy.sh`; на устройстве должны быть установлен бинарь redsocks, скрипт запуска и правила iptables.

---

## 1. Требования

- **Root** на устройстве (для iptables и запуска redsocks).
- Доступ по **ADB** (сеть, порт 5555).
- Архитектура образа: **x86/x86_64** или **arm/arm64** — под неё нужен бинарь redsocks.

---

## 2. Бинарь redsocks для Android

### Вариант A: Сборка из исходников

Репозиторий: https://github.com/darkk/redsocks  
Нужна кросс-компиляция под Android (NDK).

```bash
# Установить NDK, затем примерно:
git clone https://github.com/darkk/redsocks.git
cd redsocks
# Править Makefile: CC = $(NDK)/toolchains/llvm/.../clang, целевая triple (aarch64-linux-android, i686-linux-android и т.д.)
make
```

Получится бинарь `redsocks`. Его нужно положить на устройство в каталог, доступный при загрузке, например `/data/local/tmp/redsocks` или `/system/bin/redsocks` (если образ допускает запись).

### Вариант B: Готовый бинарь

Можно искать готовые сборки redsocks для Android (Termux, Magisk-модули и т.п.). Проверяйте архитектуру (arm, aarch64, x86, x86_64). Положите бинарь, например, в `/data/local/tmp/redsocks` и дайте права на выполнение:

```bash
adb shell su -c "chmod 755 /data/local/tmp/redsocks"
```

---

## 3. Конфиг redsocks

Формат конфига задаётся на хосте скриптом `apply-proxy.sh`; панель при старте VM пушит готовый файл в одно из мест:

- `/data/local/tmp/redsocks.conf`
- или `/sdcard/redsocks.conf`

Пример содержимого (генерируется автоматически):

```ini
base {
  log_debug = off;
  log_info = on;
  daemon = off;
  redirector = iptables;
}
redsocks {
  local_ip = 0.0.0.0;
  local_port = 12345;
  type = socks5;
  ip = proxy.example.com;
  port = 1080;
  login = user;
  password = pass;
}
```

На устройстве redsocks нужно запускать с указанием этого файла (см. ниже). **local_port** должен совпадать с портом, на который будут редиректиться соединения в iptables (здесь 12345).

---

## 4. Правила iptables (редирект TCP в redsocks)

Идея: весь исходящий TCP (кроме локального и кроме соединений к самому прокси) редиректить на `127.0.0.1:12345`. Тогда браузер и приложения будут ходить через redsocks, а redsocks — напрямую к прокси.

Правила нужно выполнять **с root** (через `su` или из init/Magisk).

### 4.1. Очистка старых правил (по желанию)

Чтобы начать с чистого листа в цепочке `nat OUTPUT`:

```bash
su -c "iptables -t nat -F OUTPUT"
```

### 4.2. Исключения и редирект

- Не трогать локальный трафик (иначе redsocks может сломаться).
- Не редиректить трафик **к самому прокси** (IP и порт прокси), иначе redsocks не сможет до него достучаться.

Подставьте свои `PROXY_IP` и `PROXY_PORT` (хост прокси и порт из конфига).

```bash
# Не редиректить localhost
iptables -t nat -A OUTPUT -p tcp -d 127.0.0.0/8 -j RETURN

# Не редиректить соединения к прокси (обязательно — иначе цикл)
# Пример: прокси 192.168.1.100:1080
iptables -t nat -A OUTPUT -p tcp -d 192.168.1.100 --dport 1080 -j RETURN

# Весь остальной исходящий TCP — в redsocks
iptables -t nat -A OUTPUT -p tcp -j REDIRECT --to-ports 12345
```

Если прокси задаётся доменом (например `proxy.example.com`), на устройстве при каждом применении прокси нужно знать его IP. Варианты:

- Прописать в скрипте запуска: резолвить `proxy.example.com` и подставлять в правило (например `getent hosts proxy.example.com` или небольшой скрипт на устройстве).
- Или на хосте при применении прокси передавать уже IP (тогда в конфиге redsocks можно оставить IP).

Для VM часто прокси — это IP хоста или другой фиксированный IP, тогда достаточно одного правила с этим IP и портом.

---

## 5. Скрипт запуска на устройстве

Ниже — пример скрипта, который: читает IP прокси из конфига, выставляет iptables, запускает redsocks. Конфиг ожидается в `/data/local/tmp/redsocks.conf`.

Сохраните на устройстве, например, как `/data/local/tmp/start-redsocks.sh` и сделайте исполняемым (`chmod +x`).

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

# Если это домен — разрешить в IP (getent или nslookup; на минимальном Android может не быть — тогда задавайте в панели IP прокси)
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

Запуск вручную (root):

```bash
su -c "/data/local/tmp/start-redsocks.sh"
```

Или через ADB с хоста:

```bash
adb shell su -c "/data/local/tmp/start-redsocks.sh"
```

Redsocks по умолчанию в конфиге не daemon — процесс будет в foreground. Для фонового запуска можно в конфиге включить `daemon = on;` (если сборка поддерживает) или запускать через `nohup ... &`.

---

## 6. Запуск при загрузке Android

Чтобы прокси поднимался после каждой загрузки, скрипт нужно вызывать из среды с root при старте системы.

### Вариант A: Magisk

- Положите скрипт в ` /data/adb/service.d/` (например `start-redsocks.sh`).
- Magisk при загрузке выполнит скрипты из этой папки с root.
- Учтите: конфиг `redsocks.conf` панель пушит уже после загрузки VM (при нажатии «Старт»). Поэтому при самом первом boot конфига может ещё не быть — тогда скрипт должен корректно завершиться (как в примере выше: «нет конфига — exit 0»). После того как панель применит прокси и положит конфиг, redsocks нужно перезапустить (повторный вызов скрипта или кнопка «Применить прокси» в панели).

### Вариант B: init.rc (если есть возможность править образ)

Добавить сервис, который запускает ваш скрипт после `boot` или `net`:

```text
service redsocks /system/bin/sh /data/local/tmp/start-redsocks.sh
    user root
    group root
    oneshot
```

Или вызывать скрипт из существующего сервиса при старте сети.

### Вариант C: Ручной запуск после каждой загрузки

Если не используете Magisk и не трогаете init: после загрузки VM и появления конфига от панели зайти по ADB и выполнить:

```bash
adb shell su -c "/data/local/tmp/start-redsocks.sh"
```

Либо добавить в панели вызов этого скрипта по ADB после пуша конфига (отдельная доработка бэкенда).

---

## 7. Порядок действий при старте VM

1. Пользователь в панели нажимает «Старт» для VM с привязанным прокси.
2. Бэкенд поднимает VM, ждёт ADB, пушит актуальный `redsocks.conf` в `/data/local/tmp/` (или `/sdcard/`).
3. На устройстве должен быть запущен redsocks с этим конфигом и выставлены iptables (скрипт из п. 5).
4. Если скрипт уже крутится при загрузке (Magisk) — после появления нового конфига нужно перезапустить redsocks (повторно выполнить скрипт). Либо в панели есть «Применить прокси» — тогда после пуша конфига можно по ADB вызывать `start-redsocks.sh`, чтобы перечитать конфиг и обновить iptables.

---

## 8. Проверка

- С хоста: `adb shell su -c "iptables -t nat -L OUTPUT -n -v"` — должны быть правила REDIRECT на 12345 и RETURN для 127.0.0.0/8 и для IP:port прокси.
- На устройстве: в браузере открыть любой внешний сайт — трафик должен идти через прокси (проверить на стороне прокси/логах).
- Если что-то не работает: убедиться, что до прокси с устройства есть сетевой доступ (ping, curl с хоста VM к proxy_ip:proxy_port).

---

## 9. Отключение прокси

Чтобы временно отключить редирект и пустить трафик напрямую:

```bash
adb shell su -c "iptables -t nat -F OUTPUT"
adb shell su -c "killall redsocks"
```

Скрипт `scripts/disable-proxy-on-device.sh` на хосте делает то же самое (только сброс iptables).
