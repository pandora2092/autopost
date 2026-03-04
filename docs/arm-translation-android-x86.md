# ARM-translation на Android-x86 (Houdini)

Установка Houdini позволяет запускать ARM-приложения (в т.ч. Instagram) на Android-x86.

## Вариант 1: Встроенная поддержка (рекомендуется)

В Android-x86 9.0 часто есть настройка:

1. Открой **Settings** → **Apps Compatibility**
2. Включи **Enable Native Bridge**
3. Система попытается скачать Houdini сама
4. Перезагрузи VM

Если автоскачивание не сработало (часто из-за сетевых ограничений), используйте вариант 2.

## Вариант 2: Скрипт install-houdini.sh

С хоста (VM должна быть запущена и доступна по ADB):

```bash
cd /home/ann/workspace/new/scripts
chmod +x install-houdini.sh
./install-houdini.sh 192.168.122.5:5555
```

После выполнения — перезагрузи VM.

## Вариант 3: Ручная установка

### Шаг 1. Скачать Houdini

- **9_y** (armhf, 32-bit ARM): http://dl.android-x86.org/houdini/9_y/houdini.sfs
- **9_z** (arm64, 64-bit ARM) — если доступен: http://dl.android-x86.org/houdini/9_z/houdini.sfs
- **Альтернатива** (Android 9): https://aopc.dev/r/houdini-arm-translation.108/

Для Instagram (arm64-v8a) лучше использовать **9_z** или **9_y** (9_y тоже часто работает).

Сохраните как `houdini9_y.sfs` (для 9_y) или `houdini9_z.sfs` (для 9_z).

### Шаг 2. Скопировать на устройство

```bash
adb connect 192.168.122.5:5555
adb push houdini9_y.sfs /data/local/tmp/
```

### Шаг 3. Установить в VM (root shell — Alt+F1)

```bash
mount -o rw,remount /system
cp /data/local/tmp/houdini9_y.sfs /system/etc/
/system/bin/enable_nativebridge
rm /data/local/tmp/houdini9_y.sfs
reboot
```

### Шаг 4. Включить Native Bridge в настройках

После перезагрузки: **Settings** → **Apps Compatibility** → **Enable Native Bridge** (если ещё не включено).

## Проверка

После установки и перезагрузки попробуйте снова установить Instagram (через фронтенд или `./install-instagram.sh`).

## Если Instagram всё равно падает (SoLoader, dso_lock, Dalvik cache)

В логах могут быть ошибки вида: `FileNotFoundException: .../lib-main/dso_lock`, `Dalvik cache directory does not exist`. Часто виноваты права или SELinux.

1. **SELinux** — временно перевести в Permissive (только для проверки):
   ```bash
   adb -s IP:5555 root
   adb -s IP:5555 shell setenforce 0
   ```
   Затем снова запустить Instagram. Если заработало — значит, политика SELinux блокирует создание файлов в `lib-main`; для постоянного решения можно настроить контекст или политику под приложение.

2. **Скрипт установки** — `install-instagram.sh` после установки создаёт каталог `lib-main` с владельцем приложения (при доступном `adb root`). Удалите Instagram, заново установите через скрипт и снова запустите.

3. **Очистка данных** — Настройки → Приложения → Instagram → Очистить данные и кэш, затем запустить приложение ещё раз.
