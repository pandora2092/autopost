import { Injectable } from '@nestjs/common';
import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { VmManagerService } from '../vm/vm-manager.service';

const ACTION_DELAY_MS = 10000;
/** Пауза после adb push, чтобы медиа-сканер успел проиндексировать файл (избежать "cannot access media"). */
const POST_PUSH_DELAY_MS = parseInt(process.env.POST_PUSH_DELAY_MS || '25000', 10);
/** Папка на устройстве для загружаемого видео. По умолчанию Download. Если в Instagram превью видно, но при выборе "cannot access media" — задайте REMOTE_MEDIA_DIR=/sdcard/DCIM (или /sdcard/DCIM/Camera). */
const REMOTE_DIR = process.env.REMOTE_MEDIA_DIR || '/sdcard/Download';
const APPIUM_HOST = process.env.APPIUM_HOST || '127.0.0.1';
const APPIUM_PORT = parseInt(process.env.APPIUM_PORT || '4723', 10);
/**
 * Ожидание завершения загрузки после Share/Continue.
 * По умолчанию ждём до 20 минут, ориентируясь на прогресс-бар "keep Instagram open".
 */
const POST_PUBLISH_TIMEOUT_MS = parseInt(process.env.POST_PUBLISH_TIMEOUT_MS || '1200000', 10);
/** Интервал опроса индикатора загрузки. */
const POST_PUBLISH_POLL_MS = parseInt(process.env.POST_PUBLISH_POLL_MS || '3000', 10);
/** Доп. пауза после завершения загрузки (на всякий случай). */
const POST_PUBLISH_DELAY_MS = parseInt(process.env.POST_PUBLISH_DELAY_MS || '0', 10);
/** Пауза после перехода на вкладку Home перед поиском индикатора "keep Instagram open". */
const POST_PUBLISH_HOME_DELAY_MS = parseInt(process.env.POST_PUBLISH_HOME_DELAY_MS || '5000', 10);
/** Сколько ждать появления вкладки Home после закрытия модалки. */
const HOME_TAB_WAIT_MS = parseInt(process.env.HOME_TAB_WAIT_MS || '20000', 10);

/**
 * Публикация Reel: Profile → Create New → Create new reel → выбор видео в галерее → Next (edit) →
 * подпись → Next (share_button) → About Reels: Share → Continue (privacy). Селекторы под версию Instagram.
 */

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

@Injectable()
export class AppiumPublishService {
  constructor(private readonly vmManager: VmManagerService) {}

  /** Переход на вкладку Home (лента) после публикации. Ждём появления элемента до HOME_TAB_WAIT_MS. */
  private async openHomeTab(driver: WebdriverIO.Browser): Promise<void> {
    const homeTabSelectors = [
      '//*[@resource-id="com.instagram.android:id/feed_tab"]',
      '//*[@content-desc="Home"][@resource-id="com.instagram.android:id/feed_tab"]',
      '//*[@content-desc="Home"]',
      '~Home',
      'android=new UiSelector().resourceId("com.instagram.android:id/feed_tab")',
      'android=new UiSelector().description("Home")',
      '//*[@resource-id="com.instagram.android:id/feed_tab"]//*[@resource-id="com.instagram.android:id/tab_icon"]',
    ];
    const startedAt = Date.now();
    while (Date.now() - startedAt < HOME_TAB_WAIT_MS) {
      for (const sel of homeTabSelectors) {
        try {
          const el = await driver.$(sel);
          if (el && (await el.isDisplayed())) {
            await el.click();
            await delay(2000);
            return;
          }
        } catch {
          continue;
        }
      }
      await delay(2000);
    }
    throw new Error(
      `Не удалось открыть вкладку Home после публикации за ${HOME_TAB_WAIT_MS}мс. Селекторы: feed_tab, content-desc="Home".`,
    );
  }

  private async waitForInstagramPostingToFinish(driver: WebdriverIO.Browser): Promise<void> {
    if (!(POST_PUBLISH_TIMEOUT_MS > 0)) return;

    const startedAt = Date.now();
    const progressBarSel = '//*[@resource-id="com.instagram.android:id/row_pending_media_progress_bar"]';
    const statusContainerSel = '//*[@resource-id="com.instagram.android:id/row_pending_media_status_container"]';

    while (Date.now() - startedAt < POST_PUBLISH_TIMEOUT_MS) {
      let uploading = false;
      try {
        const pb = await driver.$(progressBarSel);
        uploading = pb ? await pb.isDisplayed() : false;
      } catch {
        uploading = false;
      }

      if (!uploading) {
        try {
          const container = await driver.$(statusContainerSel);
          uploading = container ? await container.isDisplayed() : false;
        } catch {
          uploading = false;
        }
      }

      if (!uploading) return;
      await delay(Math.max(250, POST_PUBLISH_POLL_MS));
    }

    throw new Error(
      `Instagram не завершил публикацию за ${POST_PUBLISH_TIMEOUT_MS}мс (индикатор загрузки всё ещё виден).`,
    );
  }

  /** Клик чуть выше середины экрана, чтобы закрыть возможное модальное окно после Share/Continue. */
  private async dismissModalTapAboveCenter(driver: WebdriverIO.Browser): Promise<void> {
    try {
      const { width, height } = await driver.getWindowSize();
      const x = Math.floor(width / 2);
      const y = Math.floor(height * 0.4);
      await driver.execute('mobile: clickGesture', { x, y });
      await delay(1500);
    } catch {
      // Игнорируем: модалки может не быть или другой драйвер
    }
  }

  /**
   * После Share/Continue: закрытие модалки (тап) → переход на Home → пауза → поиск индикатора "keep Instagram open" → ожидание окончания загрузки.
   */
  private async waitForPublishCompletion(driver: WebdriverIO.Browser): Promise<void> {
    await this.dismissModalTapAboveCenter(driver);
    await this.openHomeTab(driver);
    await delay(POST_PUBLISH_HOME_DELAY_MS);
    await this.waitForInstagramPostingToFinish(driver);
  }

  /**
   * Копирует медиафайл на устройство по ADB. Возвращает путь на устройстве.
   * Ожидается, что файл в uploads уже обработан при загрузке (ensureFaststart в UploadService).
   */
  pushMediaToDevice(adbAddress: string, localPath: string): string {
    const fullPath = path.isAbsolute(localPath) ? localPath : path.join(process.cwd(), localPath);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Файл не найден: ${fullPath}`);
    }
    const name = path.basename(fullPath);
    const remotePath = `${REMOTE_DIR}/${name}`;
    try {
      execSync(`adb -s ${adbAddress} shell "mkdir -p ${REMOTE_DIR.replace(/"/g, '\\"')}"`, {
        encoding: 'utf8',
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch {
      // Игнорируем: папка может уже существовать
    }
    try {
      execSync(`adb -s ${adbAddress} push "${fullPath}" "${remotePath}"`, {
        encoding: 'utf8',
        timeout: 120000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`adb push не удался: ${msg}. Проверьте: adb connect ${adbAddress} и adb devices.`);
    }
    // Права доступа: иначе приложения (Галерея, Instagram) могут не прочитать файл.
    try {
      execSync(`adb -s ${adbAddress} shell chmod 644 "${remotePath}"`, {
        encoding: 'utf8',
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch {
      // Игнорируем
    }
    // Медиа-сканер: чтобы файл появился в галерее и был виден пикеру Instagram.
    try {
      const fileUri = `file://${remotePath}`;
      execSync(`adb -s ${adbAddress} shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d "${fileUri}"`, {
        encoding: 'utf8',
        timeout: 10000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch {
      // Игнорируем: на части устройств broadcast может не сработать.
    }
    return remotePath;
  }

  /**
   * Публикация Reel: post.media_path → adb push в /sdcard/Download → в пикере выбор первого элемента в галерее.
   */
  async publishWithAppium(
    post: { id: string; media_path: string; caption: string | null },
    adbAddress: string,
  ): Promise<void> {
    this.vmManager.adbConnect(adbAddress);
    await delay(1000);
    const remotePath = this.pushMediaToDevice(adbAddress, post.media_path);
    await delay(POST_PUSH_DELAY_MS);

    // Appium ищет устройство в adb devices — повторный connect перед сессией
    this.vmManager.adbConnect(adbAddress);
    await delay(2000);

    let wdio: typeof import('webdriverio');
    try {
      wdio = await import('webdriverio');
    } catch {
      throw new Error(
        'WebdriverIO не установлен. Выполните: npm install webdriverio @wdio/appium-service (в backend-nest).',
      );
    }

    const driver = await wdio.remote({
      hostname: APPIUM_HOST,
      port: APPIUM_PORT,
      path: '/',
      capabilities: {
        platformName: 'Android',
        'appium:automationName': 'UiAutomator2',
        'appium:udid': adbAddress,
        'appium:noReset': true,
        'appium:adbExecTimeout': 60000, // adb shell на VM может отвечать медленно
      },
      connectionRetryCount: 3,
      connectionRetryTimeout: 180000, // 3 мин — UiAutomator2 на VM может долго стартовать
    });

    try {
      await driver.activateApp('com.instagram.android');
      await delay(ACTION_DELAY_MS);

      // 1. Переход в Profile (чтобы публикация всегда начиналась с экрана профиля).
      const profileTabSelectors = [
        '~Profile',
        '//*[@content-desc="Profile"]',
        '//*[@resource-id="com.instagram.android:id/profile_tab"]',
        'android=new UiSelector().description("Profile")',
        'android=new UiSelector().resourceId("com.instagram.android:id/profile_tab")',
      ];
      let profileOpened = false;
      for (const sel of profileTabSelectors) {
        try {
          const el = await driver.$(sel);
          if (el && (await el.isDisplayed())) {
            await el.click();
            profileOpened = true;
            await delay(3000);
            break;
          }
        } catch {
          continue;
        }
      }
      if (!profileOpened) {
        throw new Error(
          'Вкладка Profile не найдена. Обновите profileTabSelectors в appium-publish.service под вашу версию Instagram.',
        );
      }

      // 2. Кнопка «Create New» (плюс в шапке профиля) — открывает меню создания поста.
      const createNewSelectors = [
        '~Create New',
        '//*[@content-desc="Create New"]',
        '//*[@resource-id="com.instagram.android:id/right_action_bar_button"]',
        'android=new UiSelector().description("Create New")',
        'android=new UiSelector().resourceId("com.instagram.android:id/right_action_bar_button")',
      ];
      let createNewClicked = false;
      for (const sel of createNewSelectors) {
        try {
          const el = await driver.$(sel);
          if (el && (await el.isDisplayed())) {
            await el.click();
            createNewClicked = true;
            await delay(ACTION_DELAY_MS);
            break;
          }
        } catch {
          continue;
        }
      }
      if (!createNewClicked) {
        throw new Error(
          'Кнопка «Create New» не найдена на экране профиля. Обновите createNewSelectors в appium-publish.service.',
        );
      }

      // 3. Селекторы для «Create new reel» (в меню после Create New). Порядок: Profile → Create New → Create new reel.
      const newPostSelectors = [
        '~Create new reel',
        '~Create new Reel',
        '//*[@content-desc="Create new reel"]',
        '//*[contains(@content-desc, "Create new reel")]',
        '//*[contains(@content-desc, "Create new Reel")]',
        'android=new UiSelector().description("Create new reel")',
        'android=new UiSelector().descriptionContains("Create new reel")',
        'android=new UiSelector().descriptionContains("reel")',
        '~Create your first post',
        '//*[@resource-id="com.instagram.android:id/igds_headline_primary_action_button"]',
        '//*[@content-desc="Create your first post"]',
        '//*[contains(@content-desc, "Create your first post")]',
        'android=new UiSelector().description("Create your first post")',
        '~New post',
        '~Create',
        '~Create new post',
        '~Новая запись',
        '~Создать',
        '//*[@content-desc="New post"]',
        '//*[@content-desc="Create"]',
        '//*[contains(@content-desc, "New post")]',
        '//*[contains(@content-desc, "Create")]',
        'android=new UiSelector().descriptionContains("New post")',
        'android=new UiSelector().descriptionContains("Create")',
      ];

      let clicked = false;
      for (const sel of newPostSelectors) {
        try {
          const el = await driver.$(sel);
          if (el && (await el.isDisplayed())) {
            await el.click();
            clicked = true;
            break;
          }
        } catch {
          continue;
        }
      }
      if (!clicked) {
        throw new Error(
          'Кнопка «Create new reel» не найдена в меню. Порядок: Profile → Create New → Create new reel. Обновите newPostSelectors под вашу версию Instagram.',
        );
      }
      await delay(ACTION_DELAY_MS);

      // 4. Открываем папку Download в пикере (файл кладём в /sdcard/Download) — иначе превью может не отображаться.
      const downloadFolderSelectors = [
        '~Download',
        '~Downloads',
        '//*[contains(@content-desc, "Download") or contains(@content-desc, "Downloads")]',
        'android=new UiSelector().descriptionContains("Download")',
      ];
      let folderOpened = false;
      for (const sel of downloadFolderSelectors) {
        try {
          const el = await driver.$(sel);
          if (el && (await el.isDisplayed())) {
            await el.click();
            await delay(4000);
            folderOpened = true;
            break;
          }
        } catch {
          continue;
        }
      }
      if (!folderOpened) {
        const recentsSelectors = ['~Recents', '~Recent', '//*[contains(@content-desc, "Recents")]'];
        for (const sel of recentsSelectors) {
          try {
            const el = await driver.$(sel);
            if (el && (await el.isDisplayed())) {
              await el.click();
              await delay(4000);
              break;
            }
          } catch {
            continue;
          }
        }
      }
      // Кнопка «Select multiple» (gallery_menu_multi_select_button) — перед выбором превью.
      const selectMultipleSelectors = [
        '//*[@resource-id="com.instagram.android:id/gallery_menu_multi_select_button"]',
        '~Select multiple',
        '//*[contains(@content-desc, "Select multiple")]',
        'android=new UiSelector().resourceId("com.instagram.android:id/gallery_menu_multi_select_button")',
      ];
      for (const sel of selectMultipleSelectors) {
        try {
          const el = await driver.$(sel);
          if (el && (await el.isDisplayed())) {
            await el.click();
            await delay(2000);
            break;
          }
        } catch {
          continue;
        }
      }
      // Выбор первого элемента из списка в галерее (как отображается в сетке).
      const thumbnailXpath = '//*[@resource-id="com.instagram.android:id/gallery_grid_item_thumbnail"]';

      const selectionCircleId = 'com.instagram.android:id/gallery_grid_item_selection_circle';
      const trySelectThumbnail = async (): Promise<boolean> => {
        const elements = await driver.$$(thumbnailXpath);
        const clickTarget = async (el: { $: (selector: string) => unknown; click: () => Promise<void> }) => {
          const circle = await (el.$(`.//*[@resource-id="${selectionCircleId}"]`) as Promise<{ isDisplayed(): Promise<boolean>; click(): Promise<void> } | undefined>);
          if (circle && (await circle.isDisplayed())) {
            await circle.click();
          } else {
            await el.click();
          }
        };
        // 1) Сначала пробуем выбрать первое видео (чтобы случайно не выбрать фото, если в Recents смешанный контент).
        for (const el of elements) {
          if (!(await el.isDisplayed())) continue;
          const desc = String((await el.getAttribute('content-desc')) || '');
          if (!/video/i.test(desc)) continue;
          await clickTarget(el as { $: (selector: string) => unknown; click: () => Promise<void> });
          await delay(ACTION_DELAY_MS);
          return true;
        }
        // 2) Если явного "Video" нет — выбираем первый видимый элемент сетки.
        for (const el of elements) {
          if (!(await el.isDisplayed())) continue;
          await clickTarget(el as { $: (selector: string) => unknown; click: () => Promise<void> });
          await delay(ACTION_DELAY_MS);
          return true;
        }
        return false;
      };

      let fileSelected = false;
      try {
        fileSelected = await trySelectThumbnail();
      } catch {
        // ignore
      }
      if (!fileSelected) {
        for (const sel of downloadFolderSelectors) {
          try {
            const el = await driver.$(sel);
            if (el && (await el.isDisplayed())) {
              await el.click();
              await delay(4000);
              break;
            }
          } catch {
            continue;
          }
        }
        try {
          fileSelected = await trySelectThumbnail();
        } catch {
          // ignore
        }
      }
      if (!fileSelected) {
        const mediaName = path.basename(post.media_path);
        throw new Error(
          `Не удалось выбрать медиа в галерее (первый элемент). Файл: "${mediaName}". Откройте в пикере папку Download/Recents и проверьте, что превью отображается и доступно для выбора.`,
        );
      }
      await delay(ACTION_DELAY_MS);

      // 5. «Next» после выбора медиа: сначала кнопка в галерее (media_thumbnail_tray_button), затем на экране редактирования (clips_right_action_button). Не тапаем «Select» — он может совпасть с кругом выбора и снять выделение.
      const editNextSelectors = [
        '//*[@resource-id="com.instagram.android:id/media_thumbnail_tray_button"]',
        '//*[@resource-id="com.instagram.android:id/media_thumbnail_tray_next_buttons_layout"]//*[@content-desc="Next"]',
        '//*[@resource-id="com.instagram.android:id/clips_right_action_button"]',
        '//*[@content-desc="Next"]',
        '~Next',
        'android=new UiSelector().resourceId("com.instagram.android:id/media_thumbnail_tray_button")',
        'android=new UiSelector().resourceId("com.instagram.android:id/clips_right_action_button")',
      ];
      for (const sel of editNextSelectors) {
        try {
          const el = await driver.$(sel);
          if (el && (await el.isDisplayed())) {
            await el.click();
            await delay(ACTION_DELAY_MS);
            break;
          }
        } catch {
          continue;
        }
      }
      // Второй «Next» — на экране редактирования рила (переход к подписи).
      const editScreenNextSelectors = [
        '//*[@resource-id="com.instagram.android:id/clips_right_action_button"]',
        '//*[@content-desc="Next"]',
        '~Next',
      ];
      for (const sel of editScreenNextSelectors) {
        try {
          const el = await driver.$(sel);
          if (el && (await el.isDisplayed())) {
            await el.click();
            await delay(ACTION_DELAY_MS);
            break;
          }
        } catch {
          continue;
        }
      }

      // 6. Подпись: «Write a caption and add hashtags...», затем Next (share_button).
      if (post.caption && post.caption.trim()) {
        const captionSelectors = [
          '~Write a caption and add hashtags...',
          '~Write a caption...',
          '~Caption',
          '~Подпись',
          '~Добавьте подпись',
          '//*[contains(@content-desc, "caption") or contains(@content-desc, "Caption")]',
          '//*[contains(@content-desc, "Подпись") or contains(@content-desc, "подпись")]',
          '//*[@resource-id="caption_input"]',
          'android=new UiSelector().className("android.widget.EditText").instance(0)',
          'android=new UiSelector().className("android.widget.EditText")',
          '//android.widget.EditText',
        ];
        for (const sel of captionSelectors) {
          try {
            const captionEl = await driver.$(sel);
            if (captionEl && (await captionEl.isDisplayed())) {
              await captionEl.setValue(post.caption.trim());
              break;
            }
          } catch {
            continue;
          }
        }
      }

      await delay(ACTION_DELAY_MS);

      // 7. Кнопка «Next» на экране подписи (share_button) — переход к публикации.
      const shareButtonSelectors = [
        '//*[@resource-id="com.instagram.android:id/share_button"]',
        '~Next',
        '~Поделиться',
        '~Share',
        '//*[@content-desc="Next"]',
        '//*[contains(@content-desc, "Next")]',
        'android=new UiSelector().resourceId("com.instagram.android:id/share_button")',
        'android=new UiSelector().description("Next")',
      ];
      let shareClicked = false;
      for (const sel of shareButtonSelectors) {
        try {
          const shareEl = await driver.$(sel);
          if (shareEl && (await shareEl.isDisplayed())) {
            await shareEl.click();
            shareClicked = true;
            break;
          }
        } catch {
          continue;
        }
      }
      if (!shareClicked) {
        throw new Error(
          'Кнопка «Next»/«Поделиться» не найдена. Обновите shareButtonSelectors в appium-publish.service.',
        );
      }
      await delay(ACTION_DELAY_MS);

      // 8. Модалка «About Reels»: кнопка Share (clips_nux_sheet_share_button).
      const aboutReelsShareSelectors = [
        '//*[@resource-id="com.instagram.android:id/clips_nux_sheet_share_button"]',
        '~Share',
        '//*[@content-desc="Share"]',
        'android=new UiSelector().resourceId("com.instagram.android:id/clips_nux_sheet_share_button")',
      ];
      for (const sel of aboutReelsShareSelectors) {
        try {
          const el = await driver.$(sel);
          if (el && (await el.isDisplayed())) {
            await el.click();
            await delay(ACTION_DELAY_MS);
            break;
          }
        } catch {
          continue;
        }
      }

      // 9. Диалог «Others can now download...»: кнопка Continue (clips_download_privacy_nux_button).
      const continueSelectors = [
        '//*[@resource-id="com.instagram.android:id/clips_download_privacy_nux_button"]',
        '~Continue',
        '//*[@content-desc="Continue"]',
        'android=new UiSelector().resourceId("com.instagram.android:id/clips_download_privacy_nux_button")',
      ];
      for (const sel of continueSelectors) {
        try {
          const el = await driver.$(sel);
          if (el && (await el.isDisplayed())) {
            await el.click();
            await delay(ACTION_DELAY_MS);
            break;
          }
        } catch {
          continue;
        }
      }

      await delay(ACTION_DELAY_MS * 2);

      await this.waitForPublishCompletion(driver);

      if (POST_PUBLISH_DELAY_MS > 0) {
        await delay(POST_PUBLISH_DELAY_MS);
      }
    } finally {
      await driver.deleteSession();
    }
  }
}
