# Система автопостинга в Instagram (Android VM)

Веб-панель для управления пулом Android VM, прокси, профилями Instagram и очередью публикаций с планированием и анти-блок мерами.

## Требования

- Хост: KVM/libvirt, virsh, qemu-img, ADB, (опционально) virt-clone, scrcpy
- Шаблонная VM: Android (например Bliss OS), настроенный ADB over network (порт 5555)
- Node.js 18+

## Варианты запуска

**Рекомендуемый (NestJS + React):** бэкенд в `backend-nest/`, фронтенд в `frontend/`. API тот же, БД общая (SQLite).

**Классический (Express + статика):** один сервер в `backend/` с панелью в `backend/public/` — см. раздел «Бэкенд Express» ниже.

---

## Запуск: NestJS + React

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

---

## Бэкенд Express (альтернатива)

```bash
cd backend
npm install
npm run init-db
export VM_TEMPLATE_DOMAIN=android-template
export PORT=3000
npm start
```

Панель: http://localhost:3000 (статический HTML из backend/public).

### 4. Прокси и VM из панели

- В разделе «Прокси» добавьте прокси (socks5/socks4/http-connect).
- В разделе «Виртуальные машины» создайте VM (имя и привязка к прокси). Клонирование выполняется через `scripts/clone-vm.sh`.
- После запуска VM укажите ADB-адрес (IP:5555) в карточке VM (кнопка/редактирование — при наличии UI для patch) или через API `PATCH /api/vm/:id` с `{ "adb_address": "192.168.122.5:5555" }`.
- Нажмите «Set Android ID» для установки уникального Android ID.

### 5. Профили и авторизация в Instagram

- Добавьте профиль, привязав его к VM.
- Установите Instagram на VM (вручную в шаблоне или через `adb install` после клонирования).
- Кнопка «Открыть экран» даёт команду для scrcpy или открывает страницу с инструкцией. Войдите в Instagram вручную в стриме/через scrcpy.

### 6. Планирование постов

- В разделе «Публикации» добавьте пост: выберите профиль, **загрузите видео MP4 (рилс)** через кнопку или укажите путь к медиа на сервере, подпись, время.
- Загруженные файлы сохраняются в `backend-nest/uploads/` (или `UPLOAD_DIR`). Старые файлы автоматически удаляются по расписанию (см. ниже).
- Планировщик каждую минуту выбирает посты с `scheduled_at <= now`, применяет лимиты (постов в день на аккаунт, минимальный интервал) и ставит их в очередь на публикацию.

**Очистка хранилища загрузок:** раз в день (по умолчанию в 03:00) удаляются файлы из `uploads/`, которые старше N дней и не привязаны к постам со статусом «ожидает»/«назначен»/«публикуется». Переменные: `UPLOAD_RETENTION_DAYS=7`, `CLEANUP_CRON='0 3 * * *'`.

### 7. Реальная публикация (Appium)

По умолчанию посты помечаются как «опубликованные» после симуляции (для проверки очереди). Для реальной публикации в приложении Instagram:

- Установите Appium и WebdriverIO: `npm install webdriverio @wdio/appium-service` (в backend).
- Запустите Appium server и укажите на устройство по ADB.
- Задайте `USE_APPIUM=1` и при необходимости доработайте `backend/src/services/appiumPublish.js` под вашу версию Instagram (селекторы кнопок и полей).

Медиа для поста должны лежать в `backend/uploads/` или по абсолютному пути в `media_path`.

## API (кратко)

- `POST /api/upload` — загрузка видео (multipart, поле `file`), ответ `{ path: "uploads/xxx.mp4" }`
- `GET/POST /api/proxy` — прокси
- `GET/POST /api/vm`, `POST /api/vm/:id/start|stop`, `DELETE /api/vm/:id`, `POST /api/vm/:id/set-android-id`
- `GET/POST /api/profiles`, `GET /api/profiles/:id/stream-url`
- `GET/POST /api/posts`, `PATCH/DELETE /api/posts/:id`
- `GET /api/system/queue`, `GET /api/system/stats`

## Структура

- `scripts/` — bash-скрипты клонирования VM, установки Android ID, генерации конфига redsocks
- `backend-nest/` — бэкенд NestJS (TypeScript), SQLite, те же API и логика (VM, прокси, профили, посты, планировщик)
- `frontend/` — React (Vite), панель: Прокси, VM, Профили, Публикации, Очередь
- `backend/` — вариант на Express + статическая панель в `backend/public/`
