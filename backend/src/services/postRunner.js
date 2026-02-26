/**
 * Выполнение публикации поста на устройстве (ADB / Appium).
 * При USE_APPIUM=1 и установленном webdriverio используется appiumPublish.
 * Иначе — симуляция (для тестов) или только загрузка медиа на устройство.
 */

const { getDb } = require('../db/client');

async function publish(post) {
  const db = getDb();
  const row = db.prepare(`
    SELECT s.id, s.profile_id, s.media_path, s.caption,
           pr.vm_id, v.adb_address, v.libvirt_domain
    FROM scheduled_post s
    JOIN profile pr ON pr.id = s.profile_id
    JOIN vm v ON v.id = pr.vm_id
    WHERE s.id = ?
  `).get(post.id);
  if (!row) throw new Error('Post or VM not found');
  const vmManager = require('./vmManager');
  let adbAddress = row.adb_address;
  if (!adbAddress) {
    const ip = vmManager.getVmIp(row.libvirt_domain);
    if (ip) adbAddress = ip + ':5555';
  }
  if (!adbAddress) {
    throw new Error('VM adb_address не задан. Запустите VM и укажите ADB (IP:5555).');
  }

  const useAppium = process.env.USE_APPIUM === '1' || process.env.USE_APPIUM === 'true';
  if (useAppium) {
    try {
      const appium = require('./appiumPublish');
      await appium.publishWithAppium(post, { adb_address: adbAddress, ip: adbAddress.replace(/:5555$/, '') });
      return { ok: true };
    } catch (err) {
      throw err;
    }
  }

  // Симуляция: задержка и успех (для проверки очереди без реального постинга).
  await new Promise((r) => setTimeout(r, 2000 + Math.random() * 3000));
  return { ok: true, message: 'Publish simulated. Set USE_APPIUM=1 and install webdriverio for real automation.' };
}

module.exports = { publish };
