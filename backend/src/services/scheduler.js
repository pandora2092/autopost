/**
 * Планировщик публикаций: раз в минуту выбирает посты, готовые к публикации,
 * применяет лимиты (постов в день на аккаунт, минимальный интервал), назначает на устройство.
 */

const cron = require('node-cron');
const { getDb } = require('../db/client');

const MAX_POSTS_PER_DAY = parseInt(process.env.MAX_POSTS_PER_DAY || '3', 10);
const MIN_INTERVAL_HOURS = parseFloat(process.env.MIN_INTERVAL_HOURS || '4');
const CRON_SCHEDULE = process.env.SCHEDULER_CRON || '* * * * *'; // каждую минуту

function getPublishedTodayCount(profileId) {
  const db = getDb();
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const r = db.prepare(
    'SELECT COUNT(*) AS c FROM scheduled_post WHERE profile_id = ? AND status = ? AND published_at >= ?'
  ).get(profileId, 'published', start.toISOString());
  return r.c;
}

function getLastPublishedAt(profileId) {
  const db = getDb();
  const r = db.prepare(
    'SELECT published_at FROM scheduled_post WHERE profile_id = ? AND status = ? AND published_at IS NOT NULL ORDER BY published_at DESC LIMIT 1'
  ).get(profileId, 'published');
  return r ? r.published_at : null;
}

function canPublishNow(profileId) {
  const todayCount = getPublishedTodayCount(profileId);
  if (todayCount >= MAX_POSTS_PER_DAY) return false;
  const lastAt = getLastPublishedAt(profileId);
  if (!lastAt) return true;
  const diffHours = (Date.now() - new Date(lastAt).getTime()) / (1000 * 60 * 60);
  return diffHours >= MIN_INTERVAL_HOURS;
}

/**
 * Выбрать посты для публикации: scheduled_at <= now, status = pending, проходят лимиты по профилю.
 */
function pickPostsToPublish() {
  const db = getDb();
  const now = new Date().toISOString();
  const rows = db.prepare(`
    SELECT id, profile_id, media_path, caption, scheduled_at
    FROM scheduled_post
    WHERE status = 'pending' AND scheduled_at <= ?
    ORDER BY scheduled_at ASC
  `).all(now);
  const allowed = [];
  for (const row of rows) {
    if (canPublishNow(row.profile_id)) {
      allowed.push(row);
    }
  }
  return allowed;
}

/**
 * Назначить пост на публикацию (статус assigned, записать assigned_at).
 * Реальную публикацию выполняет publisher (шаг 7).
 */
function assignPost(postId) {
  const db = getDb();
  db.prepare(
    'UPDATE scheduled_post SET status = ?, assigned_at = datetime("now"), updated_at = datetime("now") WHERE id = ?'
  ).run('assigned', postId);
}

function runTick() {
  const toPublish = pickPostsToPublish();
  for (const post of toPublish) {
    assignPost(post.id);
    const publisher = require('./publisher');
    publisher.enqueue(post).catch((err) => {
      const db = getDb();
      db.prepare(
        'UPDATE scheduled_post SET status = ?, error_message = ?, updated_at = datetime("now") WHERE id = ?'
      ).run('failed', (err && err.message) || String(err), post.id);
    });
  }
}

function start() {
  cron.schedule(CRON_SCHEDULE, () => {
    try {
      runTick();
    } catch (err) {
      console.error('Scheduler tick error:', err);
    }
  });
  console.log('Scheduler started (cron: %s)', CRON_SCHEDULE);
}

module.exports = { start, runTick, pickPostsToPublish, canPublishNow };
