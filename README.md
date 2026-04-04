# Система автопостинга в Instagram (Android VM)

Веб-панель для управления пулом Android VM, прокси, профилями Instagram и очередью публикаций с планированием и анти-блок мерами.

## Требования

- Хост: KVM/libvirt, virsh, qemu-img, ADB, (опционально) virt-clone, scrcpy
- Шаблонная VM: Android (например Bliss OS), настроенный ADB over network (порт 5555)
- Node.js 18+

## Запуск

### 1. Скрипты клонирования VM

```bash
chmod +x scripts/*.sh
# Задайте имя шаблона (libvirt domain):
export VM_TEMPLATE_DOMAIN=android-template
./scripts/clone-vm.sh android-template my-vm-01
```

После создания VM запустите её, дождитесь загрузки Android, выполните на хосте:
`adb connect <IP_VM>:5555`, затем `scripts/set-android-id.sh <IP_VM>:5555` для уникального Android ID.

### 2. Бэкенд (NestJS)

```bash
cd backend-nest
npm install
# БД создаётся при первом запуске (data/autopost.db)
export VM_TEMPLATE_DOMAIN=android-template   # опционально
export PORT=3000
npm run start:dev
```

API: http://localhost:3000 (GET /api/health для проверки).

### 3. Фронтенд (React, Vite)

```bash
cd frontend
npm install
npm run dev
```

Панель: http://localhost:5173 (Vite проксирует /api на бэкенд :3000).

Для продакшена: `npm run build` в frontend, затем раздавать `frontend/dist` через nginx или подмонтировать в Nest (статическая папка).

### 4. Прокси и VM из панели

- В разделе «Прокси» добавьте прокси (socks5/socks4/http-connect).
- В разделе «Виртуальные машины» создайте VM (имя и привязка к прокси). Клонирование выполняется через `scripts/clone-vm.sh`.
- После запуска VM укажите ADB-адрес (IP:5555) в карточке VM (кнопка/редактирование — при наличии UI для patch) или через API `PATCH /api/vm/:id` с `{ "adb_address": "192.168.122.5:5555" }`.
- Нажмите «Set Android ID» для установки уникального Android ID.

### 5. Профили и авторизация в Instagram

- Добавьте профиль, привязав его к VM.
- Установите Instagram на VM (вручную в шаблоне или через `adb install` после клонирования).
- Кнопка «Открыть экран» открывает стрим экрана VM в браузере (если настроен ws-scrcpy, см. ниже) или страницу с командой scrcpy для локального просмотра. Войдите в Instagram вручную в стриме/через scrcpy.

**Браузерный стрим экрана VM:** чтобы по кнопке «Открыть экран» сразу шёл стрим в браузере, на хосте с ADB и VM запустите [ws-scrcpy](https://github.com/EucalyZ/ws-scrcpy) (или форк с поддержкой `udid` в URL). В окружении бэкенда задайте один из вариантов:

- **`STREAM_WEB_BASE`** — полный базовый URL UI ws-scrcpy **так, как его открывает браузер** (не «localhost сервера», если вы заходите в панель с другой машины). Примеры: `http://localhost:8000` при разработке на одном ПК; `https://ваш-домен.ru/stream-view`, если снаружи доступен только HTTPS и путь проксируется на ws-scrcpy.
- **`STREAM_WEB_RELATIVE`** — путь под тем же хостом, что и запрос к API (удобно за nginx). Пример: `/stream-view`. Бэкенд соберёт URL из `Host` и при необходимости `X-Forwarded-Proto` / `X-Forwarded-Host`. При использовании за обратным прокси включите доверие к заголовкам: при старте задаётся `trust proxy` (число хопов через **`TRUST_PROXY_HOPS`**, по умолчанию 1).

В ответе `GET /api/profiles/:id/stream-url` появится поле `stream_web_url`; фронт откроет его по кнопке «Открыть экран». Без этих переменных открывается запасная страница с командой **scrcpy** для локального просмотра.

**Сборка ws-scrcpy:** при первой сборке (`npm run dist:prod` или `npm start`) возникает ошибка `Can't resolve '../../../vendor/Genymobile/scrcpy/server/scrcpy-server'`, так как бинарник scrcpy-server нужно собрать вручную. Требуется Java JDK 17+ и Android SDK (API 36). Выполните:

1. **Принять лицензии Android SDK.** Иначе сборка выдаст «some licences have not been accepted». Нужен `sdkmanager` (идёт в [Android Command-line Tools](https://developer.android.com/studio#command-tools) или в пакете `google-android-cmdline-tools-*-installer`). Затем:
   ```bash
   export ANDROID_HOME=/usr/lib/android-sdk   # или $HOME/Android/Sdk
   yes | sdkmanager --licenses
   ```
   Если `sdkmanager` не в PATH, укажите полный путь, например: `yes | $ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager --licenses`. При системном SDK (`/usr/lib/android-sdk`) может понадобиться: `sudo mkdir -p $ANDROID_HOME/licenses` и при необходимости `sudo yes | sdkmanager --licenses`.

2. **Собрать scrcpy-server и скопировать APK:**
   ```bash
   cd ws-scrcpy
   git submodule update --init --recursive   # если клонировали без --recursive
   export ANDROID_HOME=/usr/lib/android-sdk  # или путь к вашему SDK
   cd vendor/Genymobile/scrcpy
   ./gradlew assembleDebug
   APK=$(find server/build -name "*.apk" -type f | head -1)
   if [ -n "$APK" ]; then cp "$APK" server/scrcpy-server; else echo "APK не найден в server/build"; fi
   cd ../../..
   npm install && npm start
   ```
   Если `find` не находит APK, посмотрите вручную: `ls -la server/build/outputs/apk/debug/` или `find server/build -name "*.apk"`.

### 6. Планирование постов

- В разделе «Публикации» добавьте пост: выберите профиль, **загрузите видео MP4 (рилс)** через кнопку или укажите путь к медиа на сервере, подпись, время.
- Загруженные файлы сохраняются в `backend-nest/uploads/` (или `UPLOAD_DIR`). Старые файлы автоматически удаляются по расписанию (см. ниже).
- Планировщик каждую минуту выбирает посты с `scheduled_at <= now`, применяет лимиты (постов в день на аккаунт, минимальный интервал) и ставит их в очередь на публикацию.

**Очистка хранилища загрузок:** раз в день (по умолчанию в 03:00) удаляются файлы из `uploads/`, которые старше N дней и не привязаны к постам со статусом «ожидает»/«назначен»/«публикуется». Переменные: `UPLOAD_RETENTION_DAYS=7`, `CLEANUP_CRON='0 3 * * *'`.

### 7. Реальная публикация (Appium)

По умолчанию посты помечаются как «Симуляция» (проверка очереди без публикации). Для реальной публикации в приложении Instagram:

- В `backend-nest` уже есть зависимость `webdriverio`. Appium server запустите отдельно и привяжите к устройству по ADB.
- **В среде, где запущен Appium**, должны быть заданы переменные Android SDK: `ANDROID_HOME` или `ANDROID_SDK_ROOT` (путь к Android SDK). Иначе при создании сессии появится ошибка: «Neither ANDROID_HOME nor ANDROID_SDK_ROOT environment variable was exported».
- Переменные: `USE_APPIUM=1`, при необходимости `APPIUM_HOST=127.0.0.1`, `APPIUM_PORT=4723`.
- Сервис публикации: загрузка медиа на устройство (adb push), подключение к Appium (WebdriverIO), запуск Instagram, кнопка «Новая запись», подпись. При смене версии Instagram может потребоваться поправить селекторы в `backend-nest/src/scheduler/appium-publish.service.ts`.
- Если в VM видео не проигрывается в галерее и кнопка «Поделиться» неактивна — см. [docs/video-format-vm.md](docs/video-format-vm.md) (формат H.264, медиа-сканер). Рекомендуемые сборки Android для VM (Instagram + кодеки): [docs/android-vm-builds.md](docs/android-vm-builds.md).

Медиа для поста должны лежать в `backend-nest/uploads/` или по абсолютному пути в `media_path`.

## API (кратко)

- `POST /api/upload` — загрузка видео (multipart, поле `file`), ответ `{ path: "uploads/xxx.mp4" }`
- `GET/POST /api/proxy` — прокси
- `GET/POST /api/vm`, `POST /api/vm/:id/start|stop`, `DELETE /api/vm/:id`, `POST /api/vm/:id/set-android-id`
- `GET/POST /api/profiles`, `GET /api/profiles/:id/stream-url`
- `GET/POST /api/posts`, `PATCH/DELETE /api/posts/:id`
- `GET /api/system/queue`, `GET /api/system/stats`

## Структура

- `scripts/` — bash-скрипты клонирования VM, установки Android ID, генерации конфига redsocks
- `backend-nest/` — бэкенд NestJS (TypeScript), SQLite, API (VM, прокси, профили, посты, планировщик)
- `frontend/` — React (Vite), панель: Прокси, VM, Профили, Публикации, Очередь
