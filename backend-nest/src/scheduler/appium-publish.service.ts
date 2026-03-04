import { Injectable } from '@nestjs/common';
import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { VmManagerService } from '../vm/vm-manager.service';

const ACTION_DELAY_MS = 10000;
/** Папка на устройстве для загружаемого видео. По умолчанию Download; при проблемах с кодеками/галереей попробуйте REMOTE_MEDIA_DIR=/sdcard/DCIM */
const REMOTE_DIR = process.env.REMOTE_MEDIA_DIR || '/sdcard/Download';
const APPIUM_HOST = process.env.APPIUM_HOST || '127.0.0.1';
const APPIUM_PORT = parseInt(process.env.APPIUM_PORT || '4723', 10);

/**
 * Селекторы подстраиваются под версию Instagram (проверено для ~416).
 * Если кнопки не находятся: откройте Appium Inspector, подключитесь к устройству с запущенным
 * Instagram, найдите кнопку «Новая запись» / «Create» и поле подписи — скопируйте content-desc
 * или resource-id сюда.
 */

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

@Injectable()
export class AppiumPublishService {
  constructor(private readonly vmManager: VmManagerService) {}

  /**
   * Копирует медиафайл на устройство по ADB. Возвращает путь на устройстве.
   */
  pushMediaToDevice(adbAddress: string, localPath: string): string {
    const fullPath = path.isAbsolute(localPath) ? localPath : path.join(process.cwd(), localPath);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Файл не найден: ${fullPath}`);
    }
    const name = path.basename(fullPath);
    const remotePath = `${REMOTE_DIR}/${name}`;
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
   * Публикует пост через Appium. Используется именно то видео, что загружено на фронте при планировании:
   * post.media_path → файл на сервере → adb push в /sdcard/Download → в пикере выбираем этот файл по имени.
   */
  async publishWithAppium(
    post: { id: string; media_path: string; caption: string | null },
    adbAddress: string,
  ): Promise<void> {
    this.vmManager.adbConnect(adbAddress);
    await delay(1000);
    const remotePath = this.pushMediaToDevice(adbAddress, post.media_path);
    const mediaFileName = path.basename(post.media_path);
    const mediaNameWithoutExt = mediaFileName.replace(/\.[^.]+$/, '');
    await delay(ACTION_DELAY_MS);

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

      // Селекторы для кнопки «Новая запись» / «Create post».
      // На экране профиля с 0 постов кнопка: «Create your first post» (resource-id: igds_headline_primary_action_button).
      const newPostSelectors = [
        '~Create your first post',
        '//*[@resource-id="com.instagram.android:id/igds_headline_primary_action_button"]',
        '//*[@content-desc="Create your first post"]',
        '//*[contains(@content-desc, "Create your first post")]',
        'android=new UiSelector().resourceId("com.instagram.android:id/igds_headline_primary_action_button")',
        'android=new UiSelector().description("Create your first post")',
        '~New post',
        '~Create',
        '~Create new post',
        '~Новая запись',
        '~Создать',
        '//*[@content-desc="New post"]',
        '//*[@content-desc="Create"]',
        '//*[@content-desc="Новая запись"]',
        '//*[@content-desc="Создать"]',
        '//*[contains(@content-desc, "New post")]',
        '//*[contains(@content-desc, "Create")]',
        '//*[contains(@content-desc, "Новая")]',
        '//*[contains(@content-desc, "Создать")]',
        'android=new UiSelector().descriptionContains("New post")',
        'android=new UiSelector().descriptionContains("Create")',
        'android=new UiSelector().descriptionContains("Новая запись")',
        'android=new UiSelector().descriptionContains("Создать")',
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
          'Кнопка «Новая запись» не найдена. Обновите селекторы в appium-publish.service под вашу версию Instagram.',
        );
      }
      await delay(ACTION_DELAY_MS);

      // Выбор медиа: после «New post» открывается пикер. Файл загруженного видео уже в /sdcard/Download (имя = mediaFileName).
      // Сначала открываем папку Download(s), затем ищем и тапаем элемент с именем нашего файла.
      const gallerySelectors = [
        '~Download',
        '~Downloads',
        '~Gallery',
        '~Photos',
        '~Recent',
        '//*[contains(@content-desc, "Download") or contains(@content-desc, "Downloads")]',
        '//*[contains(@content-desc, "Gallery") or contains(@content-desc, "Photo") or contains(@content-desc, "Recent")]',
        'android=new UiSelector().descriptionContains("Download")',
        'android=new UiSelector().descriptionContains("Gallery")',
      ];
      for (const sel of gallerySelectors) {
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
      // Выбор именно загруженного видео: ищем элемент с именем файла (content-desc или text).
      const fileSelectors = [
        `//*[contains(@content-desc, "${mediaFileName}") or contains(@text, "${mediaFileName}")]`,
        `//*[contains(@content-desc, "${mediaNameWithoutExt}") or contains(@text, "${mediaNameWithoutExt}")]`,
        `android=new UiSelector().descriptionContains("${mediaFileName}")`,
        `android=new UiSelector().textContains("${mediaFileName}")`,
        `android=new UiSelector().descriptionContains("${mediaNameWithoutExt}")`,
      ];
      let fileSelected = false;
      for (const sel of fileSelectors) {
        try {
          const el = await driver.$(sel);
          if (el && (await el.isDisplayed())) {
            await el.click();
            fileSelected = true;
            await delay(ACTION_DELAY_MS);
            break;
          }
        } catch {
          continue;
        }
      }
      if (!fileSelected) {
        throw new Error(
          `Файл не найден в пикере: ${mediaFileName}. Убедитесь, что в пикере Instagram открыта папка Download и отображается загруженное видео.`,
        );
      }
      await delay(ACTION_DELAY_MS);

      if (post.caption && post.caption.trim()) {
        const captionSelectors = [
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

      // Кнопка «Next» / «Поделиться» на экране создания поста/рила (resource-id: share_button).
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
      await delay(ACTION_DELAY_MS * 2);
    } finally {
      await driver.deleteSession();
    }
  }
}
