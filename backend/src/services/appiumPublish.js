/**
 * Публикация поста в Instagram через Appium (UI-автоматизация).
 * Требует: Appium server, UIAutomator2 на устройстве, подключение по ADB.
 *
 * Установка (опционально):
 *   npm install webdriverio @wdio/appium-service
 *   На хосте: appium, adb. На устройстве: включённая отладка по USB/сети.
 *
 * Пример сценария: подключиться к устройству, открыть Instagram,
 * нажать «добавить пост», выбрать файл (предварительно push по ADB),
 * ввести подпись, отправить. Между действиями — случайные паузы 2–10 сек.
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ACTION_DELAY_MS = 2000 + Math.random() * 8000;

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Загрузить медиа на устройство через ADB (в /sdcard/Download/).
 * localPath может быть абсолютным или относительным к process.cwd() / uploads/.
 */
function pushMediaToDevice(adbAddress, localPath) {
  if (!localPath) throw new Error('media_path не задан');
  let fullPath = localPath;
  if (!path.isAbsolute(localPath)) {
    fullPath = path.join(process.cwd(), 'uploads', path.basename(localPath));
    if (!fs.existsSync(fullPath)) fullPath = path.join(process.cwd(), localPath);
  }
  if (!fs.existsSync(fullPath)) {
    throw new Error('Файл медиа не найден: ' + fullPath);
  }
  const remotePath = '/sdcard/Download/insta_' + path.basename(fullPath);
  execSync(`adb -s ${adbAddress} push "${fullPath}" "${remotePath}"`, { timeout: 60000 });
  return remotePath;
}

/**
 * Запуск публикации через Appium (если установлен webdriverio).
 * Иначе — только push медиа и открытие Instagram по deep link (если поддерживается).
 */
async function publishWithAppium(post, vmInfo) {
  const adbAddress = vmInfo.adb_address || (vmInfo.ip ? vmInfo.ip + ':5555' : null);
  if (!adbAddress) throw new Error('Нет adb_address у VM');

  const mediaPath = post.media_path;
  let remotePath;
  try {
    remotePath = pushMediaToDevice(adbAddress, mediaPath);
  } catch (e) {
    throw new Error('Не удалось загрузить медиа на устройство: ' + e.message);
  }
  await delay(ACTION_DELAY_MS);

  try {
    const wdio = await loadWebdriverIO();
    if (wdio) {
      await runWdioFlow(wdio, adbAddress, remotePath, post.caption);
      return;
    }
  } catch (e) {
    console.warn('Appium/WebdriverIO не доступен:', e.message);
  }

  // Fallback: только открыть Instagram (пользователь вручную выберет файл и подпись)
  execSync(`adb -s ${adbAddress} shell am start -n com.instagram.android/com.instagram.mainactivity.LauncherActivity`, { timeout: 5000 });
  throw new Error('Автоматизация постинга не настроена. Медиа загружено на устройство: ' + remotePath + '. Откройте Instagram вручную и опубликуйте.');
}

async function loadWebdriverIO() {
  try {
    const { remote } = require('webdriverio');
    return { remote };
  } catch (_) {
    return null;
  }
}

async function runWdioFlow(wdio, adbAddress, remotePath, caption) {
  const caps = {
    platformName: 'Android',
    'appium:automationName': 'UiAutomator2',
    'appium:deviceName': 'android',
    'appium:udid': adbAddress,
  };
  const driver = await wdio.remote({
    logLevel: 'warn',
    capabilities: caps,
  });
  try {
    await driver.activateApp('com.instagram.android');
    await delay(ACTION_DELAY_MS);
    // Найти кнопку «добавить» (resource-id или текст зависит от локали)
    const addButton = await driver.$('//*[@content-desc="New post"]') ||
      await driver.$('~New post') ||
      await driver.$('android=new UiSelector().descriptionContains("New post")');
    if (addButton) {
      await addButton.click();
      await delay(ACTION_DELAY_MS);
    }
    // Дальнейшие шаги: выбор файла, ввод подписи — зависят от версии Instagram.
    // Здесь заглушка: пользователь может доработать под свою версию приложения.
    await delay(ACTION_DELAY_MS);
  } finally {
    await driver.deleteSession();
  }
}

module.exports = {
  publishWithAppium,
  pushMediaToDevice,
};
