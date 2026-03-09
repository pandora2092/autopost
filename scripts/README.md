# Скрипты управления Android VM

## clone-vm.sh

Клонирует VM из шаблона с уникальным MAC-адресом и новым диском (qcow2 copy-on-write).

**Использование:**
```bash
./clone-vm.sh <имя_шаблона> <имя_новой_VM> [MAC]
```

Пример:
```bash
./clone-vm.sh android-template instagram-vm-01
# MAC сгенерируется автоматически. Или:
./clone-vm.sh android-template instagram-vm-01 52:54:00:aa:bb:cc
```

**Требования:** `virsh`, `qemu-img`. Для доступа к libvirt может потребоваться `sudo` или членство в группе `libvirt`.

**Переменные окружения:** `VM_DISK_POOL` (пул libvirt, по умолчанию `default`).

После создания VM запустите её (`virsh start <имя>`) и при необходимости выполните `set-android-id.sh` по IP VM (ADB over network).

---

## set-android-id.sh

Устанавливает уникальный Android ID на устройстве через ADB (снижает риск блокировок Instagram при клонировании).

**Использование:**
```bash
./set-android-id.sh <IP:port> [android_id]
```

Пример (VM с ADB на 5555):
```bash
adb connect 192.168.122.5:5555   # один раз
./set-android-id.sh 192.168.122.5:5555
# или задать свой ID:
./set-android-id.sh 192.168.122.5:5555 a1b2c3d4e5f67890
```

На устройстве обычно нужны root-права для `settings put secure android_id`.

---

## install-instagram.sh

Устанавливает APK Instagram на конкретную VM через ADB. Это **безопасный вариант**: шаблон VM остаётся без Instagram, а приложение ставится уже на каждую склонированную VM отдельно.

**Использование:**
```bash
./install-instagram.sh <IP:port> [apk_path]
```

Если `apk_path` не указан, берётся значение из переменной окружения `INSTAGRAM_APK` (на сервере).

Пример:
```bash
export INSTAGRAM_APK=/opt/apk/instagram.apk
./install-instagram.sh 192.168.122.5:5555
```

Требуется доступный `adb` и включённый ADB over network на VM.

---

## apply-proxy.sh

Генерирует конфиг redsocks и при наличии `ADB_TARGET` может отправить его на устройство и/или запустить redsocks.

**Использование:**
```bash
# Только вывести конфиг:
./apply-proxy.sh --stdout socks5 proxy.example.com 1080 [login] [password]

# Сгенерировать, отправить на устройство и запустить redsocks (например, при «Узнать IP»):
ADB_TARGET=192.168.122.5:5555 ./apply-proxy.sh socks5 proxy.example.com 1080

# Только запустить start-redsocks.sh на устройстве (конфиг уже на устройстве; при старте VM и перед публикацией):
ADB_TARGET=192.168.122.5:5555 ./apply-proxy.sh --run-only
```

Типы: `socks5`, `socks4`, `http-connect`. Панель загружает конфиг один раз (при «Узнать IP»), затем только запускает redsocks при старте VM и перед публикацией.

---

## make-test-video.sh

Генерирует короткое тестовое видео (3 с, чёрный кадр, тишина) в формате H.264 baseline, низкое разрешение — чтобы проверить, воспроизводится ли в VM вообще какое-либо видео (галерея даёт «Can't play this video» при неподдерживаемом формате).

**Использование:**
```bash
./make-test-video.sh [путь_к_файлу.mp4]
```

По умолчанию создаётся `scripts/test-video-vm.mp4`. Нужен ffmpeg. После генерации загрузите файл на устройство и откройте в галерее (команды выводятся в консоль).
