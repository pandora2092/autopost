/**
 * Очередь публикаций: по одному посту на устройство, с задержками (анти-блок).
 * Реальная публикация через ADB/Appium (см. worker или postRunner).
 */

const { getDb } = require('../db/client');

const ACTION_DELAY_MIN_MS = 2000;
const ACTION_DELAY_MAX_MS = 10000;

function randomDelay() {
  const ms = ACTION_DELAY_MIN_MS + Math.random() * (ACTION_DELAY_MAX_MS - ACTION_DELAY_MIN_MS);
  return new Promise((r) => setTimeout(r, ms));
}

let queue = [];
let running = false;

async function processOne(post) {
  const db = getDb();
  db.prepare(
    'UPDATE scheduled_post SET status = ?, updated_at = datetime("now") WHERE id = ?'
  ).run('publishing', post.id);
  await randomDelay();
  const runner = require('./postRunner');
  try {
    await runner.publish(post);
    db.prepare(
      'UPDATE scheduled_post SET status = ?, published_at = datetime("now"), updated_at = datetime("now"), error_message = NULL WHERE id = ?'
    ).run('published', post.id);
  } catch (err) {
    db.prepare(
      'UPDATE scheduled_post SET status = ?, error_message = ?, updated_at = datetime("now") WHERE id = ?'
    ).run('failed', (err && err.message) || String(err), post.id);
  }
  await randomDelay();
}

async function drain() {
  if (running || queue.length === 0) return;
  running = true;
  while (queue.length > 0) {
    const post = queue.shift();
    await processOne(post);
  }
  running = false;
}

function enqueue(post) {
  queue.push(post);
  drain();
}

module.exports = { enqueue, drain };
