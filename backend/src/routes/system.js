const express = require('express');
const { getDb } = require('../db/client');

const router = express.Router();

/**
 * Статус очереди: кто когда постит, сколько в ожидании.
 */
router.get('/queue', (req, res) => {
  const db = getDb();
  const pending = db.prepare(`
    SELECT s.id, s.profile_id, s.scheduled_at, s.status, pr.instagram_username, v.name AS vm_name
    FROM scheduled_post s
    JOIN profile pr ON pr.id = s.profile_id
    JOIN vm v ON v.id = pr.vm_id
    WHERE s.status IN ('pending','assigned','publishing')
    ORDER BY s.scheduled_at ASC
  `).all();
  const byStatus = db.prepare(`
    SELECT status, COUNT(*) AS count FROM scheduled_post GROUP BY status
  `).all();
  const recent = db.prepare(`
    SELECT s.id, s.profile_id, s.published_at, s.status, pr.instagram_username
    FROM scheduled_post s
    JOIN profile pr ON pr.id = s.profile_id
    WHERE s.status = 'published'
    ORDER BY s.published_at DESC LIMIT 20
  `).all();
  res.json({ pending, byStatus, recent });
});

router.get('/stats', (req, res) => {
  const db = getDb();
  const vmCount = db.prepare('SELECT COUNT(*) AS c FROM vm').get();
  const profileCount = db.prepare('SELECT COUNT(*) AS c FROM profile').get();
  const postCounts = db.prepare('SELECT status, COUNT(*) AS c FROM scheduled_post GROUP BY status').all();
  res.json({
    vm: vmCount.c,
    profile: profileCount.c,
    posts: postCounts.reduce((acc, r) => { acc[r.status] = r.c; return acc; }, {}),
  });
});

module.exports = router;
