const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/client');

const router = express.Router();

router.get('/', (req, res) => {
  const { status, profile_id } = req.query;
  const db = getDb();
  let sql = `
    SELECT s.id, s.profile_id, s.media_path, s.caption, s.scheduled_at, s.status, s.assigned_at, s.published_at, s.error_message, s.created_at,
           pr.instagram_username, v.name AS vm_name
    FROM scheduled_post s
    JOIN profile pr ON pr.id = s.profile_id
    JOIN vm v ON v.id = pr.vm_id
    WHERE 1=1
  `;
  const params = [];
  if (status) { sql += ' AND s.status = ?'; params.push(status); }
  if (profile_id) { sql += ' AND s.profile_id = ?'; params.push(profile_id); }
  sql += ' ORDER BY s.scheduled_at ASC';
  const rows = db.prepare(sql).all(...params);
  res.json(rows);
});

router.post('/', (req, res) => {
  const { profile_id, media_path, caption, scheduled_at } = req.body;
  if (!profile_id || !media_path) {
    return res.status(400).json({ error: 'profile_id и media_path обязательны' });
  }
  const db = getDb();
  const profile = db.prepare('SELECT id FROM profile WHERE id = ?').get(profile_id);
  if (!profile) return res.status(404).json({ error: 'Профиль не найден' });
  const id = uuidv4();
  const at = scheduled_at || new Date().toISOString();
  db.prepare(
    'INSERT INTO scheduled_post (id, profile_id, media_path, caption, scheduled_at, status) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, profile_id, media_path, caption || null, at, 'pending');
  const row = db.prepare(`
    SELECT s.id, s.profile_id, s.media_path, s.caption, s.scheduled_at, s.status, s.created_at,
           pr.instagram_username
    FROM scheduled_post s JOIN profile pr ON pr.id = s.profile_id WHERE s.id = ?
  `).get(id);
  res.status(201).json(row);
});

router.get('/:id', (req, res) => {
  const db = getDb();
  const row = db.prepare(`
    SELECT s.*, pr.instagram_username, pr.vm_id, v.name AS vm_name
    FROM scheduled_post s
    JOIN profile pr ON pr.id = s.profile_id
    JOIN vm v ON v.id = pr.vm_id
    WHERE s.id = ?
  `).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Пост не найден' });
  res.json(row);
});

router.patch('/:id', (req, res) => {
  const { status, scheduled_at, caption } = req.body;
  const db = getDb();
  const existing = db.prepare('SELECT id FROM scheduled_post WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Пост не найден' });
  if (status !== undefined) {
    db.prepare('UPDATE scheduled_post SET status = ?, updated_at = datetime("now") WHERE id = ?').run(status, req.params.id);
  }
  if (scheduled_at !== undefined) {
    db.prepare('UPDATE scheduled_post SET scheduled_at = ?, updated_at = datetime("now") WHERE id = ?').run(scheduled_at, req.params.id);
  }
  if (caption !== undefined) {
    db.prepare('UPDATE scheduled_post SET caption = ?, updated_at = datetime("now") WHERE id = ?').run(caption, req.params.id);
  }
  const row = db.prepare('SELECT * FROM scheduled_post WHERE id = ?').get(req.params.id);
  res.json(row);
});

router.delete('/:id', (req, res) => {
  const db = getDb();
  const r = db.prepare('UPDATE scheduled_post SET status = ? WHERE id = ?').run('cancelled', req.params.id);
  if (r.changes === 0) return res.status(404).json({ error: 'Пост не найден' });
  res.json({ status: 'cancelled' });
});

module.exports = router;
