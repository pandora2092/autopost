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
 * Публикация Reel: Profile → Create New → Create new reel → выбор видео в галерее → Next (edit) →
 * подпись → Next (share_button) → About Reels: Share → Continue (privacy). Селекторы под версию Instagram.
 */

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Месяцы для формата "March 12, 2026 9:21 AM" как в content-desc превью Instagram. */
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Форматирует Date в строку как в content-desc: "March 12, 2026 9:21 AM". */
function formatThumbnailDate(d: Date): string {
  const month = MONTH_NAMES[d.getMonth()];
  const day = d.getDate();
  const year = d.getFullYear();
  let hour = d.getHours();
  const ampm = hour >= 12 ? 'PM' : 'AM';
  hour = hour % 12 || 12;
  const min = d.getMinutes();
  return `${month} ${day}, ${year} ${hour}:${min.toString().padStart(2, '0')} ${ampm}`;
}

/**
 * Возвращает строку даты/времени для сопоставления с content-desc превью ("... created on March 12, 2026 9:21 AM").
 * Пытается взять mtime файла на устройстве (adb shell ls -l), иначе использует переданную дату (например, время после push).
 */
function getThumbnailDateStringFromDevice(adbAddress: string, remotePath: string, fallbackDate: Date): string {
  try {
    const out = execSync(`adb -s ${adbAddress} shell "ls -l ${remotePath.replace(/"/g, '\\"')}"`, {
      encoding: 'utf8',
      timeout: 5000,
    });
    // Типичные форматы: "Mar 12 09:21" или "2026-03-12 09:21" или "Mar 12 2025" (год в конце)
    const line = out.split('\n')[0] || '';
    const matchIso = line.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})/);
    if (matchIso) {
      const [, y, m, d, h, min] = matchIso;
      const monthIndex = parseInt(m!, 10) - 1;
      const date = new Date(parseInt(y!, 10), monthIndex, parseInt(d!, 10), parseInt(h!, 10), parseInt(min!, 10));
      return formatThumbnailDate(date);
    }
    const matchShort = line.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})\s+(\d{1,2}):(\d{2})/);
    if (matchShort) {
      const shortMonths = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const mi = shortMonths.indexOf(matchShort[1]);
      const year = fallbackDate.getFullYear();
      const date = new Date(year, mi, parseInt(matchShort[2], 10), parseInt(matchShort[3], 10), parseInt(matchShort[4], 10));
      return formatThumbnailDate(date);
    }
  } catch {
    // игнорируем
  }
  return formatThumbnailDate(fallbackDate);
}

@Injectable()
export class AppiumPublishService {
  constructor(private readonly vmManager: VmManagerService) {}

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
   * Публикация Reel: post.media_path → adb push в /sdcard/Download → в пикере выбор превью по дате (content-desc "created on ...").
   */
  async publishWithAppium(
    post: { id: string; media_path: string; caption: string | null },
    adbAddress: string,
  ): Promise<void> {
    this.vmManager.adbConnect(adbAddress);
    await delay(1000);
    const remotePath = this.pushMediaToDevice(adbAddress, post.media_path);
    const pushTime = new Date();
    const expectedThumbnailDateStr = getThumbnailDateStringFromDevice(adbAddress, remotePath, pushTime);
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
      // Выбор по времени создания: content-desc вида "Unselected Video thumbnail created on March 12, 2026 9:21 AM". Сопоставление по полной дате, по дате без времени, по "March 12"; запасной вариант — первое видео.
      const thumbnailXpath = '//*[@resource-id="com.instagram.android:id/gallery_grid_item_thumbnail"]';
      const dateOnlyStr = expectedThumbnailDateStr.replace(/\s+\d{1,2}:\d{2}\s*[AP]M$/i, '').trim();
      const monthDayStr = expectedThumbnailDateStr.replace(/,?\s+\d{4}.*$/i, '').trim();

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
        for (const el of elements) {
          if (!(await el.isDisplayed())) continue;
          const desc = (await el.getAttribute('content-desc')) || '';
          if (!desc.includes('Video')) continue;
          const matchesDate =
            desc.includes(expectedThumbnailDateStr) ||
            desc.includes(dateOnlyStr) ||
            desc.includes(monthDayStr) ||
            desc.replace(/\s*[AP]M$/i, '').includes(expectedThumbnailDateStr.replace(/\s*[AP]M$/i, '').trim());
          if (matchesDate) {
            await clickTarget(el as { $: (selector: string) => unknown; click: () => Promise<void> });
            await delay(ACTION_DELAY_MS);
            return true;
          }
        }
        for (const el of elements) {
          if (!(await el.isDisplayed())) continue;
          const d = (await el.getAttribute('content-desc')) || '';
          if (d.includes('Video')) {
            await clickTarget(el as { $: (selector: string) => unknown; click: () => Promise<void> });
            await delay(ACTION_DELAY_MS);
            return true;
          }
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
          `Превью не найдено: файл "${mediaName}", ожидаемая дата в content-desc "created on ${expectedThumbnailDateStr}". Откройте в пикере папку Download и проверьте, что превью отображается и дата совпадает.`,
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
    } finally {
      await driver.deleteSession();
    }
  }
}
