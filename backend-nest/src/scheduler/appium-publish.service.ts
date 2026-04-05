import { Injectable } from '@nestjs/common';
import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { VmManagerService } from '../vm/vm-manager.service';
import { PublishCancellationRegistry } from './publish-cancellation.registry';

const ACTION_DELAY_MS = 10000;
/** Пауза после adb push, чтобы медиа-сканер успел проиндексировать файл (избежать "cannot access media"). */
const POST_PUSH_DELAY_MS = parseInt(process.env.POST_PUSH_DELAY_MS || '25000', 10);
/** Папка на устройстве для загружаемого видео. По умолчанию Download. Если в Instagram превью видно, но при выборе "cannot access media" — задайте REMOTE_MEDIA_DIR=/sdcard/DCIM (или /sdcard/DCIM/Camera). */
const REMOTE_DIR = process.env.REMOTE_MEDIA_DIR || '/sdcard/Download';
const APPIUM_HOST = process.env.APPIUM_HOST || '127.0.0.1';
const APPIUM_PORT = parseInt(process.env.APPIUM_PORT || '4723', 10);
/**
 * После появления «Sharing to Reels…» — максимум времени на исчезновение (фоновая загрузка).
 * По умолчанию 20 минут.
 */
const POST_PUBLISH_TIMEOUT_MS = parseInt(process.env.POST_PUBLISH_TIMEOUT_MS || '1200000', 10);
/** Сколько ждать появления текста «Sharing to Reels» (status_text) после Share/Continue. */
const SHARING_TO_REELS_APPEAR_TIMEOUT_MS = parseInt(
  process.env.SHARING_TO_REELS_APPEAR_TIMEOUT_MS || '120000',
  10,
);
/** Интервал опроса индикатора загрузки. */
const POST_PUBLISH_POLL_MS = parseInt(process.env.POST_PUBLISH_POLL_MS || '3000', 10);
/** Доп. пауза после завершения загрузки (на всякий случай). */
const POST_PUBLISH_DELAY_MS = parseInt(process.env.POST_PUBLISH_DELAY_MS || '0', 10);

const YOUTUBE_APP_ID = 'com.google.android.youtube';
const YOUTUBE_HOME_ACTIVITY = 'com.google.android.youtube.app.honeycomb.Shell$HomeActivity';
const VK_APP_ID = 'com.vkontakte.android';
/** После Publish: успех — попап title «Clip published on profile» или экран загрузки clip_upload_title «Uploaded» / «Загружен». */
const VK_CLIP_UPLOAD_TIMEOUT_MS = parseInt(process.env.VK_CLIP_UPLOAD_TIMEOUT_MS || '1200000', 10);
/** Опрос успеха VK (мс). Короткий попап — по умолчанию 25. VK_CLIP_SUCCESS_POLL_MS или VK_CLIP_UPLOAD_POLL_MS. */
const VK_CLIP_SUCCESS_POLL_MS = parseInt(
  process.env.VK_CLIP_SUCCESS_POLL_MS || process.env.VK_CLIP_UPLOAD_POLL_MS || '25',
  10,
);
/** Ожидание фоновой загрузки на YouTube после публикации (по UI «Uploading» / «Загрузка»). */
const YOUTUBE_POST_PUBLISH_TIMEOUT_MS = parseInt(process.env.YOUTUBE_POST_PUBLISH_TIMEOUT_MS || '1200000', 10);
/** Снекбар «Uploaded…» быстро исчезает — короткий интервал опроса (мс). Env: YOUTUBE_UPLOAD_SUCCESS_POLL_MS. */
const YOUTUBE_UPLOAD_SUCCESS_POLL_MS = parseInt(process.env.YOUTUBE_UPLOAD_SUCCESS_POLL_MS || '100', 10);
/** После выбора клипа / входа в редактор Reels Instagram может показать диалог с кнопкой «Not now» (auxiliary_button). Опрос (мс). 0 — не ждать (только одна проверка на вызов). Env: INSTAGRAM_REELS_NOT_NOW_TIMEOUT_MS. */
const INSTAGRAM_REELS_NOT_NOW_TIMEOUT_MS = parseInt(
  process.env.INSTAGRAM_REELS_NOT_NOW_TIMEOUT_MS || '4000',
  10,
);
/** Промо Edits / «Get App» в редакторе Reels: опрос перед тапом по превью над шитом. Env: INSTAGRAM_REELS_GET_APP_TIMEOUT_MS. */
const INSTAGRAM_REELS_GET_APP_TIMEOUT_MS = parseInt(
  process.env.INSTAGRAM_REELS_GET_APP_TIMEOUT_MS || '4000',
  10,
);
/** Шит «Update on your original audio»: кнопка clips_original_audio_nux_sheet_share_button после Next на экране подписи. Env: INSTAGRAM_REELS_ORIGINAL_AUDIO_TIMEOUT_MS. */
const INSTAGRAM_REELS_ORIGINAL_AUDIO_TIMEOUT_MS = parseInt(
  process.env.INSTAGRAM_REELS_ORIGINAL_AUDIO_TIMEOUT_MS || '5000',
  10,
);
/** Шит «New ways to reuse» и аналоги: OK на bb_primary_action_container. Env: INSTAGRAM_REELS_BB_OK_TIMEOUT_MS. */
const INSTAGRAM_REELS_BB_OK_TIMEOUT_MS = parseInt(
  process.env.INSTAGRAM_REELS_BB_OK_TIMEOUT_MS || '4000',
  10,
);

/**
 * Публикация Reel: Profile → Create New → Create new reel → выбор видео в галерее → Next (edit) →
 * при необходимости «Not now» на auxiliary_button / промо Edits («Get App» — тап выше шита) → подпись → при необходимости OK (bb_primary_action_container) → Share или Next → при необходимости Share на шите original audio → About Reels: Share → Continue (privacy). Селекторы под версию Instagram.
 *
 * YouTube Shorts: Create → «Upload a video» → папка Download → видео → Next → подпись/описание → Publish.
 * Селекторы могут отличаться по версии приложения — при сбое обновите runYoutubeShortFlow.
 *
   * VK Clip: Create → Clip → видео в пикере по имени файла (picker_photo + content-desc) → Next ×2 →
   * описание (clip_description_edit) → Edit → Publish → ожидание «Clip published on profile» или «Uploaded» (clip_upload_title).
   * См. runVkClipFlow.
 */

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

@Injectable()
export class AppiumPublishService {
  constructor(
    private readonly vmManager: VmManagerService,
    private readonly publishCancelRegistry: PublishCancellationRegistry,
  ) {}

  private async delayCancellable(postId: string, ms: number): Promise<void> {
    const chunk = 400;
    for (let left = ms; left > 0; left -= chunk) {
      this.publishCancelRegistry.throwIfCancelled(postId);
      await delay(Math.min(chunk, left));
    }
  }

  /**
   * Диалог после выбора видео / при входе в редактор Reels: кнопка «Not now» (com.instagram.android:id/auxiliary_button).
   * @param maxWaitMs максимум опроса; ≤0 — одна попытка без ожидания между проверками.
   */
  private async dismissInstagramReelsNotNowIfPresent(
    driver: WebdriverIO.Browser,
    postId: string,
    maxWaitMs?: number,
  ): Promise<void> {
    const limit = maxWaitMs ?? INSTAGRAM_REELS_NOT_NOW_TIMEOUT_MS;
    const selectors = [
      '//*[@resource-id="com.instagram.android:id/auxiliary_button" and (@text="Not now" or @text="Не сейчас")]',
      'android=new UiSelector().resourceId("com.instagram.android:id/auxiliary_button").text("Not now")',
      'android=new UiSelector().resourceId("com.instagram.android:id/auxiliary_button").text("Не сейчас")',
      '~Not now',
    ];
    const pollMs = 350;
    const tryClick = async (): Promise<boolean> => {
      for (const sel of selectors) {
        try {
          const el = await driver.$(sel);
          if (el && (await el.isDisplayed())) {
            await el.click();
            await delay(2000);
            return true;
          }
        } catch {
          continue;
        }
      }
      return false;
    };
    const deadline = Date.now() + (limit > 0 ? limit : 0);
    do {
      this.publishCancelRegistry.throwIfCancelled(postId);
      if (await tryClick()) return;
      if (limit <= 0) break;
      await this.delayCancellable(postId, pollMs);
    } while (Date.now() < deadline);
  }

  /**
   * Bottom sheet «Edits» / «Get App» (igds_button / ig_text): закрытие тапом по области превью выше шита, не по кнопке.
   * INSTAGRAM_EDITS_SHEET_DISMISS_Y_RATIO — доля высоты экрана для запасного Y (0–1), по умолчанию 0.25.
   */
  private async dismissInstagramReelsEditsGetAppSheetIfPresent(
    driver: WebdriverIO.Browser,
    postId: string,
    maxWaitMs?: number,
  ): Promise<void> {
    const limit = maxWaitMs ?? INSTAGRAM_REELS_GET_APP_TIMEOUT_MS;
    const getAppSelectors = [
      '//*[@resource-id="com.instagram.android:id/ig_text" and (@text="Get App" or @text="Получить приложение")]',
      '//*[@resource-id="com.instagram.android:id/igds_button"]//*[@text="Get App"]',
      'android=new UiSelector().resourceId("com.instagram.android:id/ig_text").text("Get App")',
      '~Get App',
    ];
    const sheetHeadlineSelectors = [
      '//*[contains(@text,"Level up your videos")]',
      '//*[contains(@text,"video creation app from Instagram")]',
    ];
    const pollMs = 350;
    const fallbackYRatio = parseFloat(process.env.INSTAGRAM_EDITS_SHEET_DISMISS_Y_RATIO || '0.25');

    const findAnchor = async (): Promise<{
      getLocation(): Promise<{ x: number; y: number }>;
    } | null> => {
      for (const sel of getAppSelectors) {
        try {
          const el = await driver.$(sel);
          if (el && (await el.isDisplayed())) return el;
        } catch {
          continue;
        }
      }
      for (const sel of sheetHeadlineSelectors) {
        try {
          const el = await driver.$(sel);
          if (el && (await el.isDisplayed())) return el;
        } catch {
          continue;
        }
      }
      return null;
    };

    const tapAboveSheet = async (): Promise<boolean> => {
      const anchor = await findAnchor();
      if (!anchor) return false;
      try {
        const rect = await driver.getWindowRect();
        const loc = await anchor.getLocation();
        const tapX = Math.round(rect.width / 2);
        const btnTopY = loc.y;
        const lift = Math.round(rect.height * 0.42);
        let tapY = Math.min(Math.round(rect.height * fallbackYRatio), btnTopY - lift);
        tapY = Math.max(Math.round(rect.height * 0.08), tapY);
        await driver.execute('mobile: clickGesture', { x: tapX, y: tapY });
        await delay(2000);
        return true;
      } catch {
        return false;
      }
    };

    const deadline = Date.now() + (limit > 0 ? limit : 0);
    do {
      this.publishCancelRegistry.throwIfCancelled(postId);
      if (await tapAboveSheet()) return;
      if (limit <= 0) break;
      await this.delayCancellable(postId, pollMs);
    } while (Date.now() < deadline);
  }

  /**
   * После подписи: если нажали Next, может открыться шит «Update on your original audio» — финальный Share
   * (clips_original_audio_nux_sheet_share_button), не путать с About Reels (clips_nux_sheet_share_button).
   */
  private async clickInstagramReelsOriginalAudioSheetShareIfPresent(
    driver: WebdriverIO.Browser,
    postId: string,
    maxWaitMs?: number,
  ): Promise<void> {
    const limit = maxWaitMs ?? INSTAGRAM_REELS_ORIGINAL_AUDIO_TIMEOUT_MS;
    const selectors = [
      '//*[@resource-id="com.instagram.android:id/clips_original_audio_nux_sheet_share_button"]',
      'android=new UiSelector().resourceId("com.instagram.android:id/clips_original_audio_nux_sheet_share_button")',
    ];
    const pollMs = 350;
    const tryClick = async (): Promise<boolean> => {
      for (const sel of selectors) {
        try {
          const el = await driver.$(sel);
          if (el && (await el.isDisplayed())) {
            await el.click();
            await delay(ACTION_DELAY_MS);
            return true;
          }
        } catch {
          continue;
        }
      }
      return false;
    };
    const deadline = Date.now() + (limit > 0 ? limit : 0);
    do {
      this.publishCancelRegistry.throwIfCancelled(postId);
      if (await tryClick()) return;
      if (limit <= 0) break;
      await this.delayCancellable(postId, pollMs);
    } while (Date.now() < deadline);
  }

  /**
   * Bottom sheet вроде «New ways to reuse»: первичная кнопка OK (bb_primary_action_container, content-desc OK).
   */
  private async dismissInstagramReelsBbSheetOkIfPresent(
    driver: WebdriverIO.Browser,
    postId: string,
    maxWaitMs?: number,
  ): Promise<void> {
    const limit = maxWaitMs ?? INSTAGRAM_REELS_BB_OK_TIMEOUT_MS;
    const selectors = [
      '//*[@resource-id="com.instagram.android:id/bb_primary_action_container"]',
      'android=new UiSelector().resourceId("com.instagram.android:id/bb_primary_action_container")',
      '~OK',
      'android=new UiSelector().description("OK")',
    ];
    const pollMs = 350;
    const tryClick = async (): Promise<boolean> => {
      for (const sel of selectors) {
        try {
          const el = await driver.$(sel);
          if (el && (await el.isDisplayed())) {
            await el.click();
            await delay(ACTION_DELAY_MS);
            return true;
          }
        } catch {
          continue;
        }
      }
      return false;
    };
    const deadline = Date.now() + (limit > 0 ? limit : 0);
    do {
      this.publishCancelRegistry.throwIfCancelled(postId);
      if (await tryClick()) return;
      if (limit <= 0) break;
      await this.delayCancellable(postId, pollMs);
    } while (Date.now() < deadline);
  }

  /** Экран загрузки Reels: com.instagram.android:id/status_text — «Sharing to Reels…». */
  private async isSharingToReelsUiVisible(driver: WebdriverIO.Browser): Promise<boolean> {
    const statusSel = '//*[@resource-id="com.instagram.android:id/status_text"]';
    try {
      const el = await driver.$(statusSel);
      if (!el || !(await el.isDisplayed())) return false;
      const text = ((await el.getText()) || '').toLowerCase();
      return text.includes('sharing') && text.includes('reel');
    } catch {
      return false;
    }
  }

  /**
   * После Share/Continue: ждём появления «Sharing to Reels…», затем — пока блок загрузки не исчезнет.
   */
  private async waitForSharingToReelsToFinish(driver: WebdriverIO.Browser, postId: string): Promise<void> {
    if (!(POST_PUBLISH_TIMEOUT_MS > 0)) return;

    const startedAt = Date.now();
    let seenSharing = false;
    let firstSeenAt: number | null = null;

    while (true) {
      this.publishCancelRegistry.throwIfCancelled(postId);
      const now = Date.now();
      const visible = await this.isSharingToReelsUiVisible(driver);

      if (visible) {
        if (firstSeenAt === null) firstSeenAt = now;
        seenSharing = true;
      } else if (seenSharing) {
        return;
      }

      if (!seenSharing) {
        if (now - startedAt >= SHARING_TO_REELS_APPEAR_TIMEOUT_MS) {
          throw new Error(
            `Не появился индикатор «Sharing to Reels…» (com.instagram.android:id/status_text) за ${SHARING_TO_REELS_APPEAR_TIMEOUT_MS}мс.`,
          );
        }
      } else if (firstSeenAt !== null && now - firstSeenAt >= POST_PUBLISH_TIMEOUT_MS) {
        throw new Error(
          `Instagram не завершил загрузку Reels за ${POST_PUBLISH_TIMEOUT_MS}мс после появления индикатора (текст «Sharing to Reels…» всё ещё виден).`,
        );
      }

      await delay(Math.max(250, POST_PUBLISH_POLL_MS));
    }
  }

  /** После Share/Continue: ожидание завершения фоновой публикации Reels по UI «Sharing to Reels…». */
  private async waitForPublishCompletion(driver: WebdriverIO.Browser, postId: string): Promise<void> {
    await this.waitForSharingToReelsToFinish(driver, postId);
  }

  /**
   * VK: после Publish — успех по любому из вариантов:
   * попап id/title «Clip published on profile» (или «Клип опубликован»), либо clip_upload_title «Uploaded» / «Загружен».
   */
  private async waitForVkClipPublishedSuccess(driver: WebdriverIO.Browser, postId: string): Promise<void> {
    if (!(VK_CLIP_UPLOAD_TIMEOUT_MS > 0)) return;
    const startedAt = Date.now();
    const publishedMarkers = ['Clip published on profile', 'Клип опубликован'];
    const titleXp = '//*[@resource-id="com.vkontakte.android:id/title"]';
    const clipUploadTitleXp = '//*[@resource-id="com.vkontakte.android:id/clip_upload_title"]';
    const poll = Math.max(10, VK_CLIP_SUCCESS_POLL_MS);
    const quickPasses = 12;
    const quickDelayMs = 8;

    const textIsPublishedPopup = (text: string | undefined): boolean =>
      !!text && publishedMarkers.some((m) => text.includes(m));

    const textIsUploadedScreen = (text: string | undefined): boolean =>
      !!text && (text.includes('Uploaded') || text.includes('Загружен'));

    const tryElementsByXp = async (xp: string, match: (t: string) => boolean): Promise<boolean> => {
      try {
        const els = await driver.$$(xp);
        const n = await els.length;
        for (let i = 0; i < n; i++) {
          try {
            const t = (await els[i].getText()) || '';
            if (match(t)) return true;
          } catch {
            continue;
          }
        }
      } catch {
        // ignore
      }
      return false;
    };

    const tryAnyVkSuccessElement = async (): Promise<boolean> => {
      if (await tryElementsByXp(titleXp, textIsPublishedPopup)) return true;
      if (await tryElementsByXp(clipUploadTitleXp, textIsUploadedScreen)) return true;
      return false;
    };

    const pageSourceIndicatesSuccess = (src: string): boolean => {
      if (publishedMarkers.some((m) => src.includes(m))) return true;
      if (!src.includes('clip_upload_title')) return false;
      return (
        src.includes('text="Uploaded"') ||
        src.includes('text="Загружен"') ||
        src.includes("text='Uploaded'") ||
        src.includes("text='Загружен'")
      );
    };

    while (Date.now() - startedAt < VK_CLIP_UPLOAD_TIMEOUT_MS) {
      this.publishCancelRegistry.throwIfCancelled(postId);
      for (let q = 0; q < quickPasses; q++) {
        if (await tryAnyVkSuccessElement()) {
          await delay(400);
          return;
        }
        await delay(quickDelayMs);
      }

      try {
        const src = await driver.getPageSource();
        if (src && pageSourceIndicatesSuccess(src)) {
          await delay(400);
          return;
        }
      } catch {
        // ignore
      }

      await delay(poll);
    }
    throw new Error(
      `VK: за ${VK_CLIP_UPLOAD_TIMEOUT_MS}мс не появилось ни «Clip published on profile» (id/title), ни «Uploaded»/«Загружен» (clip_upload_title).`,
    );
  }

  private async waitForYoutubeUploadFinish(driver: WebdriverIO.Browser, postId: string): Promise<void> {
    if (!(YOUTUBE_POST_PUBLISH_TIMEOUT_MS > 0)) return;
    const poll = Math.max(25, YOUTUBE_UPLOAD_SUCCESS_POLL_MS);
    const startedAt = Date.now();
    let seenUploading = false;
    let seenUploaded = false;
    while (Date.now() - startedAt < YOUTUBE_POST_PUBLISH_TIMEOUT_MS) {
      this.publishCancelRegistry.throwIfCancelled(postId);
      let uploadingVisible = false;
      const hints = [
        '//android.widget.TextView[contains(@text,"Uploading")]',
        '//android.widget.TextView[contains(@text,"Загрузка")]',
        '//*[contains(@text,"Uploading")]',
      ];
      for (const xp of hints) {
        try {
          const el = await driver.$(xp);
          if (el && (await el.isDisplayed())) {
            uploadingVisible = true;
            seenUploading = true;
            break;
          }
        } catch {
          // ignore
        }
      }

      // Snackbar "Uploaded to Your Channel" (completion)
      const uploadedHints = [
        '//*[@resource-id="com.google.android.youtube:id/message" and (contains(@text,"Uploaded to Your Channel") or contains(@text,"Uploaded"))]',
        '//*[@resource-id="com.google.android.youtube:id/message" and (contains(@text,"Загружено") or contains(@text,"канал"))]',
        '//*[@resource-id="com.google.android.youtube:id/youtube_snackbar"]//*[@resource-id="com.google.android.youtube:id/message"]',
        '//*[contains(@text,"Uploaded to Your Channel")]',
      ];
      for (const xp of uploadedHints) {
        try {
          const el = await driver.$(xp);
          if (el && (await el.isDisplayed())) {
            seenUploaded = true;
            break;
          }
        } catch {
          // ignore
        }
      }

      if (seenUploaded) {
        // даём UI стабилизироваться, чтобы Publisher успел корректно завершить сессию
        await delay(3000);
        return;
      }

      if (seenUploading && !uploadingVisible) {
        if (POST_PUBLISH_DELAY_MS > 0) await delay(POST_PUBLISH_DELAY_MS);
        // Снекбар может мелькнуть сразу после исчезновения «Uploading» — без длинной слепой паузы.
        await delay(poll);
        const snackbarIters = Math.max(40, Math.ceil(10000 / poll));
        for (let i = 0; i < snackbarIters; i++) {
          for (const xp of uploadedHints) {
            try {
              const el = await driver.$(xp);
              if (el && (await el.isDisplayed())) {
                await delay(1500);
                return;
              }
            } catch {
              // ignore
            }
          }
          await delay(poll);
        }
        return;
      }
      await delay(poll);
    }
  }

  private resolveYoutubeLaunchActivities(adbAddress: string): string[] {
    const candidates = [YOUTUBE_HOME_ACTIVITY];
    try {
      const out = execSync(`adb -s ${adbAddress} shell cmd package resolve-activity --brief ${YOUTUBE_APP_ID}`, {
        encoding: 'utf8',
        timeout: 10000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const lines = out
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
      const launchLine = lines.find((line) => line.includes('/'));
      if (launchLine) {
        const [, rawActivity = ''] = launchLine.split('/');
        const normalizedActivity = rawActivity.startsWith('.')
          ? `${YOUTUBE_APP_ID}${rawActivity}`
          : rawActivity;
        if (normalizedActivity) candidates.unshift(normalizedActivity);
      }
    } catch {
      // fallback below
    }
    return [...new Set(candidates)];
  }

  private async launchYoutubeApp(driver: WebdriverIO.Browser, adbAddress: string, postId: string): Promise<void> {
    const isYoutubeForeground = async (): Promise<boolean> => {
      try {
        const pkg = await (driver as unknown as { getCurrentPackage(): Promise<string> }).getCurrentPackage();
        return pkg === YOUTUBE_APP_ID;
      } catch {
        return false;
      }
    };
    const waitYoutubeForeground = async (timeoutMs: number): Promise<boolean> => {
      const started = Date.now();
      while (Date.now() - started < timeoutMs) {
        this.publishCancelRegistry.throwIfCancelled(postId);
        if (await isYoutubeForeground()) return true;
        await delay(300);
      }
      return false;
    };
    const activities = this.resolveYoutubeLaunchActivities(adbAddress);
    let lastError: unknown;
    for (const activity of activities) {
      try {
        execSync(`adb -s ${adbAddress} shell am start -n ${YOUTUBE_APP_ID}/${activity}`, {
          encoding: 'utf8',
          timeout: 15000,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        if (await waitYoutubeForeground(7000)) return;
      } catch (err) {
        lastError = err;
      }
      try {
        await driver.execute('mobile: startActivity', {
          appPackage: YOUTUBE_APP_ID,
          appActivity: activity,
        });
        if (await waitYoutubeForeground(7000)) return;
      } catch (err) {
        lastError = err;
      }
      try {
        await driver.execute('mobile: startActivity', {
          intent: `-n ${YOUTUBE_APP_ID}/${activity}`,
        });
        if (await waitYoutubeForeground(7000)) return;
      } catch (err) {
        lastError = err;
      }
      try {
        execSync(`adb -s ${adbAddress} shell monkey -p ${YOUTUBE_APP_ID} -c android.intent.category.LAUNCHER 1`, {
          encoding: 'utf8',
          timeout: 10000,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        if (await waitYoutubeForeground(7000)) return;
      } catch (err) {
        lastError = err;
      }
      try {
        execSync(
          `adb -s ${adbAddress} shell am start -a android.intent.action.MAIN -c android.intent.category.LAUNCHER -n ${YOUTUBE_APP_ID}/${activity}`,
          {
            encoding: 'utf8',
            timeout: 10000,
            stdio: ['pipe', 'pipe', 'pipe'],
          },
        );
        if (await waitYoutubeForeground(7000)) return;
      } catch (err) {
        lastError = err;
      }
    }
    throw new Error(
      `Не удалось запустить YouTube (${YOUTUBE_APP_ID}) через adb am start и startActivity. Проверьте appActivity и установку приложения. Причина: ${String(lastError)}`,
    );
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

  private async runInstagramReelFlow(
    driver: WebdriverIO.Browser,
    post: { id: string; media_path: string; caption: string | null },
  ): Promise<void> {
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

      // Опциональный диалог «Not now» до первого Next (если перекрывает ленту/трей).
      await this.dismissInstagramReelsNotNowIfPresent(driver, post.id, 0);

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

      // После перехода к редактору клипа может появиться тот же «Not now» — закрыть и дальше второй Next.
      await this.dismissInstagramReelsNotNowIfPresent(driver, post.id);

      // Промо Edits («Get App»): тап по превью выше шита, затем как обычно второй Next.
      await this.dismissInstagramReelsEditsGetAppSheetIfPresent(driver, post.id);

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

      // 6b. Шит «New ways to reuse» и т.п. может перекрыть экран подписи — OK перед Share/Next.
      await this.dismissInstagramReelsBbSheetOkIfPresent(driver, post.id);

      // 7. Экран подписи: чаще всего сразу Share (share_button); иначе Next → шит original audio с отдельным Share.
      const shareButtonSelectors = [
        '//*[@resource-id="com.instagram.android:id/share_button" and (contains(@content-desc,"Share") or contains(@content-desc,"Поделиться"))]',
        '//*[@resource-id="com.instagram.android:id/share_button"]',
        '~Next',
        '//*[@content-desc="Next"]',
        '//*[contains(@content-desc, "Next")]',
        '~Поделиться',
        '~Share',
        'android=new UiSelector().resourceId("com.instagram.android:id/share_button")',
        'android=new UiSelector().description("Next")',
        'android=new UiSelector().description("Share")',
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
          'Кнопка «Share»/«Next»/«Поделиться» на экране подписи не найдена. Обновите shareButtonSelectors в appium-publish.service.',
        );
      }
      await delay(ACTION_DELAY_MS);

      // 7a. Тот же OK-шит может появиться после первого Share/Next на подписи.
      await this.dismissInstagramReelsBbSheetOkIfPresent(driver, post.id);

      // 7b. Шит «Update on your original audio» (после Next на подписи): Share на clips_original_audio_nux_sheet_share_button.
      await this.clickInstagramReelsOriginalAudioSheetShareIfPresent(driver, post.id);

      // 7c. OK снова после промежуточных шитов (редко).
      await this.dismissInstagramReelsBbSheetOkIfPresent(driver, post.id, 0);

      // 8. Модалка «About Reels»: Share (clips_nux_sheet_share_button). Резерв: original audio, если шит открылся с задержкой.
      const aboutReelsShareSelectors = [
        '//*[@resource-id="com.instagram.android:id/bb_primary_action_container"]',
        'android=new UiSelector().resourceId("com.instagram.android:id/bb_primary_action_container")',
        '~OK',
        '//*[@resource-id="com.instagram.android:id/clips_original_audio_nux_sheet_share_button"]',
        'android=new UiSelector().resourceId("com.instagram.android:id/clips_original_audio_nux_sheet_share_button")',
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

      await this.dismissInstagramReelsBbSheetOkIfPresent(driver, post.id, 0);

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

      await this.waitForPublishCompletion(driver, post.id);

      if (POST_PUBLISH_DELAY_MS > 0) {
        await delay(POST_PUBLISH_DELAY_MS);
      }
  }


  private async runYoutubeShortFlow(
    driver: WebdriverIO.Browser,
    adbAddress: string,
    post: { id: string; media_path: string; title: string | null; caption: string | null },
    attempt = 0,
  ): Promise<void> {
    await this.launchYoutubeApp(driver, adbAddress, post.id);

    const clickFirstVisible = async (selectors: string[]): Promise<boolean> => {
      for (const sel of selectors) {
        try {
          const el = await driver.$(sel);
          if (el && (await el.isDisplayed())) {
            await el.click();
            return true;
          }
        } catch {
          continue;
        }
      }
      return false;
    };
    const isDocumentsUiVisible = async (): Promise<boolean> => {
      const selectors = [
        '//*[contains(@resource-id,"documentsui:id/dir_list")]',
        '//*[contains(@resource-id,"documentsui:id/toolbar")]',
        '//*[contains(@resource-id,"documentsui:id/thumbnail")]',
        '//*[contains(@text,"Recent")]',
        '//*[contains(@text,"Modified")]',
        'android=new UiSelector().resourceIdMatches(".*documentsui:id/dir_list")',
        'android=new UiSelector().resourceIdMatches(".*documentsui:id/thumbnail")',
      ];
      for (const sel of selectors) {
        try {
          const el = await driver.$(sel);
          if (el && (await el.isDisplayed())) return true;
        } catch {
          continue;
        }
      }
      return false;
    };
    const openUploadPicker = async (): Promise<boolean> => {
      if (await isDocumentsUiVisible()) return true;
      const uploadEntrySelectors = [
        '//*[@content-desc="Upload"]',
        '//*[@content-desc="Upload a video"]',
        '~Upload',
        '~Upload a video',
        '//*[contains(@text,"Upload a video")]',
        '//*[contains(@text,"Upload video")]',
        '//*[contains(@text,"Загрузить видео")]',
        '//*[@resource-id="com.google.android.youtube:id/bottom_sheet_list"]//*[@content-desc="Upload"]',
        '(//*[@resource-id="com.google.android.youtube:id/bottom_sheet_list"]//android.view.ViewGroup)[3]',
      ];
      for (const sel of uploadEntrySelectors) {
        if (await clickFirstVisible([sel])) {
          await delay(1200);
          if (await isDocumentsUiVisible()) return true;
        }
      }
      // fallback: тап по вероятному месту пункта Upload в bottom sheet
      try {
        const rect = await driver.getWindowRect();
        const x = Math.round(rect.width * 0.5);
        const y = Math.round(rect.height * 0.83);
        await driver.execute('mobile: clickGesture', { x, y });
        await delay(1200);
        if (await isDocumentsUiVisible()) return true;
      } catch {
        // ignore
      }
      return await isDocumentsUiVisible();
    };

    // 1) Create
    const createSelectors = [
      '//android.widget.Button[@content-desc="Create"]',
      '//android.widget.Button[@content-desc="Создать"]',
      '//*[@content-desc="Create"]',
      '//*[@content-desc="Создать"]',
      '~Create',
      'android=new UiSelector().description("Create")',
      'android=new UiSelector().descriptionContains("Create")',
      'android=new UiSelector().descriptionContains("Созд")',
      '//*[@resource-id="com.google.android.youtube:id/image"]',
      '//*[@resource-id="com.google.android.youtube:id/image"]/ancestor::android.widget.Button[1]',
    ];
    let createTapped = await clickFirstVisible(createSelectors);
    if (!createTapped) {
      try {
        const rect = await driver.getWindowRect();
        const x = Math.round(rect.width / 2);
        const y = Math.round(rect.height * 0.93);
        await driver.execute('mobile: clickGesture', { x, y });
        createTapped = true;
      } catch {
        // ignore and fallback to adb tap below
      }
    }
    if (!createTapped) {
      try {
        execSync(`adb -s ${adbAddress} shell input tap 540 2230`, {
          encoding: 'utf8',
          timeout: 5000,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        createTapped = true;
      } catch {
        // ignore
      }
    }
    if (!createTapped) {
      throw new Error('Не найдена кнопка Create в YouTube (включая fallback по иконке и координатам).');
    }
    console.log('[YT] Create tapped');
    await delay(ACTION_DELAY_MS);
    if (!(await openUploadPicker())) {
      console.warn('[YT] Upload picker not detected after Create, trying direct tile taps');
    } else {
      console.log('[YT] Upload picker detected');
    }

    // 2) В picker: двойной клик по последнему видео.
    const pickLastVideoDoubleClick = async (): Promise<boolean> => {
      const titleVisible = async (): Promise<boolean> => {
        const selectors = [
          '//android.widget.EditText[contains(@text,"Create a title")]',
          '//android.widget.EditText[contains(@text,"Title")]',
          '//*[@resource-id="com.google.android.youtube:id/loading_frame_layout"]',
        ];
        for (const sel of selectors) {
          try {
            const el = await driver.$(sel);
            if (el && (await el.isDisplayed())) return true;
          } catch {
            continue;
          }
        }
        return false;
      };
      const tapBoundsCenterTwice = (bounds: string): boolean => {
        const m = bounds.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
        if (!m) return false;
        const x1 = parseInt(m[1], 10);
        const y1 = parseInt(m[2], 10);
        const x2 = parseInt(m[3], 10);
        const y2 = parseInt(m[4], 10);
        const x = Math.round((x1 + x2) / 2);
        const y = Math.round((y1 + y2) / 2);
        execSync(`adb -s ${adbAddress} shell input tap ${x} ${y}`, {
          encoding: 'utf8',
          timeout: 5000,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        execSync(`adb -s ${adbAddress} shell input tap ${x} ${y}`, {
          encoding: 'utf8',
          timeout: 5000,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        return true;
      };
      // 0) Самый надежный путь: парсим XML и тапаем по bounds ПЕРВОГО элемента (новейший в списке).
      try {
        const src = await driver.getPageSource();
        const boundsMatches: string[] = [];
        const nodeRe = /<node\b[^>]*\/>/g;
        const nodes = src.match(nodeRe) || [];
        for (const node of nodes) {
          const hasThumbId = node.includes('resource-id="com.android.documentsui:id/thumbnail"');
          const hasIconThumb = node.includes('resource-id="com.android.documentsui:id/icon_thumb"');
          const hasIconMime = node.includes('resource-id="com.android.documentsui:id/icon_mime_lg"');
          if (!hasThumbId && !hasIconThumb && !hasIconMime) continue;
          // Приоритет: сначала thumbnail, затем icon_thumb/icon_mime.
          if (!hasThumbId && boundsMatches.length > 0) continue;
          const b = node.match(/bounds="(\[[^\"]+\])"/);
          if (b?.[1]) boundsMatches.push(b[1]);
        }
        if (boundsMatches.length) {
          const firstBounds = boundsMatches[0];
          if (tapBoundsCenterTwice(firstBounds)) {
            await delay(2500);
            if ((await titleVisible()) || !(await isDocumentsUiVisible())) {
              console.log('[YT] Video picked by first bounds');
              return true;
            }
          }
        }
      } catch {
        // ignore
      }
      // 0.1) Явно пробуем первый LinearLayout в списке dir_list (как в вашей разметке).
      try {
        const firstRowSelectors = [
          '//*[contains(@resource-id,"documentsui:id/dir_list")]/android.widget.LinearLayout[1]',
          '(//*[contains(@resource-id,"documentsui:id/dir_list")]//android.widget.LinearLayout)[1]',
          '(//*[@resource-id="com.android.documentsui:id/dir_list"]/android.widget.LinearLayout)[1]',
        ];
        for (const sel of firstRowSelectors) {
          const row = await driver.$(sel);
          if (!row) continue;
          await row.click();
          await delay(180);
          await row.click();
          await delay(2200);
          if ((await titleVisible()) || !(await isDocumentsUiVisible())) {
            console.log('[YT] Video picked by first LinearLayout');
            return true;
          }
        }
      } catch {
        // ignore
      }
      // Пробуем координатный выбор сразу (экран Recent на части устройств не всегда хорошо матчится селекторами).
      try {
        const rect = await driver.getWindowRect();
        const y = Math.round(rect.height * 0.26);
        // Сначала первая плитка (первая запись), затем следующая.
        const xs = [Math.round(rect.width * 0.12), Math.round(rect.width * 0.25)];
        for (const x of xs) {
          execSync(`adb -s ${adbAddress} shell input tap ${x} ${y}`, {
            encoding: 'utf8',
            timeout: 5000,
            stdio: ['pipe', 'pipe', 'pipe'],
          });
          await delay(220);
          execSync(`adb -s ${adbAddress} shell input tap ${x} ${y}`, {
            encoding: 'utf8',
            timeout: 5000,
            stdio: ['pipe', 'pipe', 'pipe'],
          });
          await delay(2200);
          if ((await titleVisible()) || !(await isDocumentsUiVisible())) {
            console.log('[YT] Video picked by coordinate double-tap');
            return true;
          }
        }
      } catch {
        // ignore
      }
      const candidateXpaths = [
        '//*[contains(@resource-id,"documentsui:id/dir_list")]//*[contains(@resource-id,"documentsui:id/thumbnail")]',
        '//*[contains(@resource-id,"documentsui:id/thumbnail")]',
        '//*[contains(@resource-id,"documentsui:id/thumbnail")]/ancestor::android.widget.LinearLayout[1]',
        '//*[contains(@resource-id,"documentsui:id/icon_thumb")]/ancestor::*[contains(@resource-id,"documentsui:id/thumbnail")][1]',
        '//*[contains(@resource-id,"documentsui:id/thumbnail")]/..',
        '//android.widget.FrameLayout[contains(@resource-id,"documentsui:id/thumbnail")]',
        '//*[contains(@resource-id,"documentsui:id/dir_list")]/android.widget.LinearLayout',
        '//android.support.v7.widget.RecyclerView//*[contains(@resource-id,"thumbnail")]',
        '//android.widget.ImageView[contains(@resource-id,"icon_thumb")]',
      ];
      for (const xp of candidateXpaths) {
        try {
          const els = await driver.$$(xp);
          const elsCount = await els.length;
          if (!elsCount) continue;
          // Выбираем сначала первый элемент списка (новейший), затем последующие.
          for (let i = 0; i < elsCount; i++) {
            const target = await els[i];
            try {
              await target.click();
              await delay(180);
              await target.click();
            } catch {
              const loc = await target.getLocation();
              const size = await target.getSize();
              const x = Math.round(loc.x + size.width / 2);
              const y = Math.round(loc.y + size.height / 2);
              execSync(`adb -s ${adbAddress} shell input tap ${x} ${y}`, {
                encoding: 'utf8',
                timeout: 5000,
                stdio: ['pipe', 'pipe', 'pipe'],
              });
              await delay(180);
              execSync(`adb -s ${adbAddress} shell input tap ${x} ${y}`, {
                encoding: 'utf8',
                timeout: 5000,
                stdio: ['pipe', 'pipe', 'pipe'],
              });
            }
            await delay(2000);
            if ((await titleVisible()) || !(await isDocumentsUiVisible())) {
              console.log('[YT] Video picked by element double-tap');
              return true;
            }
          }
        } catch {
          continue;
        }
      }
      // Жесткий fallback: 2 плитки в первой строке (как на вашем скрине Recent).
      try {
        const rect = await driver.getWindowRect();
        // Сначала правая плитка (последняя), затем левая.
        const y = Math.round(rect.height * 0.26);
        const xs = [Math.round(rect.width * 0.25), Math.round(rect.width * 0.12)];
        for (const x of xs) {
          execSync(`adb -s ${adbAddress} shell input tap ${x} ${y}`, {
            encoding: 'utf8',
            timeout: 5000,
            stdio: ['pipe', 'pipe', 'pipe'],
          });
          await delay(180);
          execSync(`adb -s ${adbAddress} shell input tap ${x} ${y}`, {
            encoding: 'utf8',
            timeout: 5000,
            stdio: ['pipe', 'pipe', 'pipe'],
          });
          await delay(2000);
          if ((await titleVisible()) || !(await isDocumentsUiVisible())) {
            console.log('[YT] Video picked by fallback tile taps');
            return true;
          }
        }
      } catch {
        // ignore
      }
      return false;
    };
    const mediaName = path.basename(post.media_path);
    if (!(await pickLastVideoDoubleClick())) {
      throw new Error(
        `Не удалось выбрать последнее видео двойным кликом в системной галерее. Файл: "${mediaName}".`,
      );
    }

    // 3) Create title
    const titleText = (post.title || '').trim() || path.parse(post.media_path).name;
    const adbEscapeText = (s: string): string =>
      s
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/ /g, '%s')
        .replace(/[&|<>;$`]/g, '');
    const readCurrentPackage = async (): Promise<string> => {
      try {
        return await (driver as unknown as { getCurrentPackage(): Promise<string> }).getCurrentPackage();
      } catch {
        return '';
      }
    };
    const tryFillTitleFromPageSource = async (): Promise<boolean> => {
      try {
        const src = await driver.getPageSource();
        const patterns = [
          /<node\b[^>]*class="android\.widget\.EditText"[^>]*text="Create a title"[^>]*bounds="(\[[^\"]+\])"[^>]*\/>/,
          /<node\b[^>]*text="Create a title"[^>]*class="android\.widget\.EditText"[^>]*bounds="(\[[^\"]+\])"[^>]*\/>/,
          /<node\b[^>]*class="android\.widget\.EditText"[^>]*bounds="(\[[^\"]+\])"[^>]*\/>/g,
        ];
        let bounds = '';
        const m1 = src.match(patterns[0]);
        const m2 = src.match(patterns[1]);
        if (m1?.[1]) bounds = m1[1];
        else if (m2?.[1]) bounds = m2[1];
        else {
          const all = Array.from(src.matchAll(patterns[2] as RegExp));
          if (all.length) bounds = all[all.length - 1][1];
        }
        if (!bounds) return false;
        const m = bounds.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
        if (!m) return false;
        const x = Math.round((parseInt(m[1], 10) + parseInt(m[3], 10)) / 2);
        const y = Math.round((parseInt(m[2], 10) + parseInt(m[4], 10)) / 2);
        execSync(`adb -s ${adbAddress} shell input tap ${x} ${y}`, {
          encoding: 'utf8',
          timeout: 5000,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        await delay(300);
        execSync(`adb -s ${adbAddress} shell input text "${adbEscapeText(titleText)}"`, {
          encoding: 'utf8',
          timeout: 5000,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        return true;
      } catch {
        return false;
      }
    };
    // На некоторых прошивках экран после выбора видео появляется с заметной задержкой.
    for (let i = 0; i < 30; i++) {
      if (await tryFillTitleFromPageSource()) {
        console.log('[YT] Title filled via pageSource wait');
        break;
      }
      await delay(500);
    }
    const titleSelectors = [
      '//android.widget.EditText[contains(@text,"Create a title")]',
      '//android.widget.EditText[contains(@text,"Title")]',
      'android=new UiSelector().className("android.widget.EditText").instance(0)',
      'android=new UiSelector().className("android.widget.EditText")',
      '//android.widget.EditText',
    ];
    let titleFilled = false;
    for (const sel of titleSelectors) {
      try {
        const field = await driver.$(sel);
        if (field) {
          await field.click();
          await field.setValue(titleText);
          titleFilled = true;
          break;
        }
      } catch {
        continue;
      }
    }
    if (!titleFilled) {
      titleFilled = await tryFillTitleFromPageSource();
    }
    if (!titleFilled) {
      const pkg = await readCurrentPackage();
      if (pkg.includes('launcher')) {
        console.warn('[YT] Unexpected launcher foreground, relaunching YouTube before title fill');
        await this.launchYoutubeApp(driver, adbAddress, post.id);
        await delay(2000);
        titleFilled = await tryFillTitleFromPageSource();
      }
    }
    if (!titleFilled) {
      const pkg = await readCurrentPackage();
      if (attempt < 1 && pkg.includes('launcher')) {
        console.warn('[YT] Retrying full YouTube flow after launcher fallback');
        await this.runYoutubeShortFlow(driver, adbAddress, post, attempt + 1);
        return;
      }
      throw new Error('Не найдено поле Create a title для YouTube Shorts.');
    }
    console.log('[YT] Title filled');
    await delay(1200);

    // 4) Show more
    const showMoreSelectors = [
      '//*[@content-desc="Show more"]',
      '//*[@content-desc="Показать больше"]',
      '//*[contains(@text,"Show more")]',
    ];
    if (!(await clickFirstVisible(showMoreSelectors))) {
      throw new Error('Не найдена кнопка Show more на экране деталей YouTube.');
    }
    await delay(1500);

    // 5) Открываем пункт "Add description" (а не "Select audience").
    const descriptionEntrySelectors = [
      // Text-based (best effort across languages)
      '//*[contains(@text,"Add description")]',
      '//*[contains(@content-desc,"Add description")]',
      '//*[contains(@text,"Добавить описание")]',
      '//*[contains(@content-desc,"Добавить описание")]',

      // Click parent container (ViewGroup) that holds the text.
      '//android.view.ViewGroup[.//*[contains(@text,"Add description")]]',
      '//android.view.ViewGroup[.//*[contains(@content-desc,"Add description")]]',
      '//android.view.ViewGroup[.//*[contains(@text,"Добавить описание")]]',
      '//android.view.ViewGroup[.//*[contains(@content-desc,"Добавить описание")]]',

      // Ordinal fallback: 11-й android.view.ViewGroup в списке деталей (как вы попросили).
      '(//*[@resource-id="com.google.android.youtube:id/recycler_view"]//android.view.ViewGroup)[11]',
    ];
    if (!(await clickFirstVisible(descriptionEntrySelectors))) {
      throw new Error('Не удалось открыть пункт описания ("Add description") в Show more.');
    }
    await delay(1500);

    // 6) Ввод description (подпись) + Back
    const descriptionText = (post.caption || '').trim();
    if (descriptionText) {
      const descriptionSelectors = [
        '//*[@resource-id="com.google.android.youtube:id/loading_frame_layout"]//android.widget.EditText',
        '//android.view.ViewGroup[@content-desc="Back"]/ancestor::android.view.ViewGroup[1]//android.widget.EditText',
        '//android.widget.EditText',
        'android=new UiSelector().className("android.widget.EditText").instance(0)',
      ];
      let descriptionFilled = false;
      for (const sel of descriptionSelectors) {
        try {
          const field = await driver.$(sel);
          if (field && (await field.isDisplayed())) {
            await field.click();
            await field.setValue(descriptionText);
            descriptionFilled = true;
            break;
          }
        } catch {
          continue;
        }
      }
      if (!descriptionFilled) {
        throw new Error('Не найдено поле EditText для ввода описания Shorts.');
      }
    }
    await delay(800);
    const backSelectors = ['//*[@content-desc="Back"]', '~Back', 'android=new UiSelector().description("Back")'];
    if (!(await clickFirstVisible(backSelectors))) {
      await driver.back();
    }
    await delay(1200);

    // 7) Upload
    const uploadSelectors = [
      '//*[@resource-id="com.google.android.youtube:id/upload_bottom_button"]',
      '//*[@text="Upload"]',
      '~Upload',
      '//*[@content-desc="Upload"]',
    ];
    if (!(await clickFirstVisible(uploadSelectors))) {
      throw new Error('Не найдена кнопка Upload на экране публикации YouTube.');
    }
    await delay(1500);

    // 8) Модалка аудитории: No (8-й ViewGroup), затем Upload.
    const modalNoSelectors = [
      // В вашем UI: 4-й пункт ViewGroup внутри ViewGroup в bottom_sheet_list.
      '(//*[@resource-id="com.google.android.youtube:id/bottom_sheet_list"]/android.view.ViewGroup/android.view.ViewGroup)[4]',
      '(//*[@resource-id="com.google.android.youtube:id/bottom_sheet_list"]/android.view.ViewGroup[1]/android.view.ViewGroup)[4]',
      '(//*[@resource-id="com.google.android.youtube:id/bottom_sheet_list"]/android.view.ViewGroup[1]/android.view.ViewGroup)[3]',
      '(//*[@resource-id="com.google.android.youtube:id/bottom_sheet_list"]/android.view.ViewGroup[1]/android.view.ViewGroup)[5]',
      '//*[@resource-id="com.google.android.youtube:id/bottom_sheet_list"]//*[@content-desc="No"]',
      '//*[@resource-id="com.google.android.youtube:id/bottom_sheet_list"]//*[contains(@text,"not made for kids")]',
      '//*[@resource-id="com.google.android.youtube:id/bottom_sheet_list"]//*[contains(@text,"No")]',
    ];
    if (!(await clickFirstVisible(modalNoSelectors))) {
      throw new Error('Не найден выбор "No" в модальном окне YouTube.');
    }
    await delay(1200);
    if (!(await clickFirstVisible(uploadSelectors))) {
      throw new Error('Не найдена финальная кнопка Upload после выбора аудитории.');
    }
    await delay(ACTION_DELAY_MS);

    await delay(ACTION_DELAY_MS * 2);
    await this.waitForYoutubeUploadFinish(driver, post.id);
    if (POST_PUBLISH_DELAY_MS > 0) await delay(POST_PUBLISH_DELAY_MS);
  }

  /**
   * VK: клип — Create → Clip → выбор видео по basename в content-desc у picker_photo → Next → Next →
   * подпись → Edit → Publish → ожидание «Clip published on profile» или «Uploaded» (clip_upload_title).
   */
  private async runVkClipFlow(
    driver: WebdriverIO.Browser,
    post: { id: string; media_path: string; caption: string | null },
    adbAddress: string,
  ): Promise<void> {
    const clickFirstVisible = async (selectors: string[]): Promise<boolean> => {
      for (const sel of selectors) {
        try {
          const el = await driver.$(sel);
          if (el && (await el.isDisplayed())) {
            await el.click();
            return true;
          }
        } catch {
          continue;
        }
      }
      return false;
    };

    await driver.activateApp(VK_APP_ID);
    await delay(ACTION_DELAY_MS);

    // 1. Create
    const createSelectors = [
      '~Create',
      '//*[@content-desc="Create"]',
      '//*[@resource-id="com.vkontakte.android:id/posting_button_container"]',
      '//*[@resource-id="com.vkontakte.android:id/posting_button"]',
      'android=new UiSelector().description("Create")',
    ];
    if (!(await clickFirstVisible(createSelectors))) {
      throw new Error(
        'VK: не найдена кнопка Create (content-desc / posting_button). Обновите селекторы в runVkClipFlow.',
      );
    }
    await delay(ACTION_DELAY_MS);

    // 2. Clip
    const clipSelectors = [
      '//android.widget.TextView[@text="Clip"]',
      '//*[@text="Clip"]',
      '~Clip',
    ];
    if (!(await clickFirstVisible(clipSelectors))) {
      throw new Error('VK: не найден пункт Clip в меню создания.');
    }
    await delay(ACTION_DELAY_MS);

    // 3. Видео в галерее по имени файла (как в content-desc у picker_photo)
    const baseName = path.basename(post.media_path);
    const pickerXp = '//*[@resource-id="com.vkontakte.android:id/picker_photo"]';
    let videoClicked = false;
    const deadline = Date.now() + Math.max(POST_PUSH_DELAY_MS, 45000);
    while (!videoClicked && Date.now() < deadline) {
      this.publishCancelRegistry.throwIfCancelled(post.id);
      try {
        const els = await driver.$$(pickerXp);
        const n = await els.length;
        for (let i = 0; i < n; i++) {
          const el = els[i];
          try {
            const desc = (await el.getAttribute('content-desc')) || '';
            if (desc.includes(baseName) && (await el.isDisplayed())) {
              await el.click();
              videoClicked = true;
              break;
            }
          } catch {
            continue;
          }
        }
      } catch {
        // ignore
      }
      if (!videoClicked) await delay(1500);
    }
    if (!videoClicked) {
      throw new Error(
        `VK: не найдено видео в пикере по имени «${baseName}» (picker_photo + content-desc). Проверьте adb push и индексацию медиа.`,
      );
    }
    await delay(ACTION_DELAY_MS);

    // 4–5. Next дважды
    const nextSelectors = [
      '//*[@resource-id="com.vkontakte.android:id/entry_points_photos_go"]',
      '//*[@resource-id="com.vkontakte.android:id/ds_internal_button_title" and @text="Next"]',
      '~Next',
      '//*[@content-desc="Next"]',
      '//*[@text="Next"]',
    ];
    for (let i = 0; i < 2; i++) {
      if (!(await clickFirstVisible(nextSelectors))) {
        throw new Error(`VK: не найдена кнопка Next (шаг ${i + 1} из 2).`);
      }
      await delay(ACTION_DELAY_MS);
    }

    // 6–8. Описание (до 4000 символов), сохранение через Edit
    const cap = (post.caption || '').trim();
    if (cap) {
      const text = cap.length > 4000 ? cap.slice(0, 4000) : cap;
      const descEntrySelectors = [
        '~Add a description',
        '//*[@content-desc="Add a description"]',
      ];
      await clickFirstVisible(descEntrySelectors);
      await delay(1200);

      const editSelectors = [
        '//*[@resource-id="com.vkontakte.android:id/clip_description_edit"]',
        '//android.widget.FrameLayout[@resource-id="com.vkontakte.android:id/clip_description_container"]//android.widget.EditText',
      ];
      let filled = false;
      for (const sel of editSelectors) {
        try {
          const field = await driver.$(sel);
          if (field && (await field.isDisplayed())) {
            await field.setValue(text);
            filled = true;
            break;
          }
        } catch {
          continue;
        }
      }
      if (!filled) {
        throw new Error(
          'VK: не найдено поле clip_description_edit для подписи к клипу.',
        );
      }
      await delay(800);
      const saveSelectors = [
        '//*[@resource-id="com.vkontakte.android:id/ivEndIcon"]',
        '~Edit',
        '//*[@content-desc="Edit"]',
      ];
      if (!(await clickFirstVisible(saveSelectors))) {
        throw new Error('VK: не найдена кнопка Edit для сохранения описания.');
      }
      await delay(ACTION_DELAY_MS);
    }

    // 9. Publish
    const publishSelectors = [
      '//android.widget.TextView[@text="Publish"]',
      '//*[@text="Publish"]',
      '~Publish',
    ];
    if (!(await clickFirstVisible(publishSelectors))) {
      throw new Error('VK: не найдена кнопка Publish.');
    }
    await delay(2000);
    await this.waitForVkClipPublishedSuccess(driver, post.id);
    if (POST_PUBLISH_DELAY_MS > 0) await delay(POST_PUBLISH_DELAY_MS);
  }

  /**
   * Публикация: adb push mp4 → Reels (Instagram), Shorts (YouTube) или Clip (VK) по профилю.
   */
  async publishWithAppium(
    post: { id: string; media_path: string; title: string | null; caption: string | null },
    adbAddress: string,
    socialNetwork: 'instagram' | 'youtube' | 'vk' = 'instagram',
  ): Promise<void> {
    const postId = post.id;
    try {
      this.publishCancelRegistry.throwIfCancelled(postId);
      this.vmManager.adbConnect(adbAddress);
      await this.delayCancellable(postId, 1000);
      this.pushMediaToDevice(adbAddress, post.media_path);
      await this.delayCancellable(postId, POST_PUSH_DELAY_MS);

      this.vmManager.adbConnect(adbAddress);
      await this.delayCancellable(postId, 2000);

      let wdio: typeof import('webdriverio');
      try {
        wdio = await import('webdriverio');
      } catch {
        throw new Error(
          'WebdriverIO не установлен. Выполните: npm install webdriverio @wdio/appium-service (в backend-nest).',
        );
      }

      this.publishCancelRegistry.throwIfCancelled(postId);
      const driver = await wdio.remote({
        hostname: APPIUM_HOST,
        port: APPIUM_PORT,
        path: '/',
        capabilities: {
          platformName: 'Android',
          'appium:automationName': 'UiAutomator2',
          'appium:udid': adbAddress,
          'appium:noReset': true,
          'appium:adbExecTimeout': 60000,
        },
        connectionRetryCount: 3,
        connectionRetryTimeout: 180000,
      });

      let sessionClosed = false;
      const closeDriver = async () => {
        if (sessionClosed) return;
        sessionClosed = true;
        try {
          await driver.deleteSession();
        } catch {
          // сессия уже закрыта (отмена) или устройство недоступно
        }
      };
      this.publishCancelRegistry.registerSessionCloser(postId, closeDriver);
      try {
        if (socialNetwork === 'youtube') {
          await this.runYoutubeShortFlow(driver, adbAddress, post);
        } else if (socialNetwork === 'vk') {
          await this.runVkClipFlow(driver, post, adbAddress);
        } else {
          await this.runInstagramReelFlow(driver, post);
        }
      } finally {
        await closeDriver();
        this.publishCancelRegistry.unregisterSessionCloser(postId);
      }
    } finally {
      this.publishCancelRegistry.clearCancelled(postId);
    }
  }
}
