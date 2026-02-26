const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/client');

const router = express.Router();

router.get('/', (req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT id, type, host, port, login, created_at FROM proxy ORDER BY created_at DESC').all();
  res.json(rows);
});

router.post('/', (req, res) => {
  const { type, host, port, login, password } = req.body;
  if (!type || !host || !port) {
    return res.status(400).json({ error: 'type, host, port обязательны' });
  }
  const id = uuidv4();
  const db = getDb();
  db.prepare(
    'INSERT INTO proxy (id, type, host, port, login, password) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, type, host, Number(port), login || null, password || null);
  const row = db.prepare('SELECT id, type, host, port, login, created_at FROM proxy WHERE id = ?').get(id);
  res.status(201).json(row);
});

router.get('/:id', (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT id, type, host, port, login, created_at FROM proxy WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Прокси не найден' });
  res.json(row);
});

router.patch('/:id', (req, res) => {
  const { type, host, port, login, password } = req.body;
  const db = getDb();
  const existing = db.prepare('SELECT id FROM proxy WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Прокси не найден' });
  db.prepare(
    'UPDATE proxy SET type = COALESCE(?, type), host = COALESCE(?, host), port = COALESCE(?, port), login = ?, password = ? WHERE id = ?'
  ).run(type ?? null, host ?? null, port != null ? Number(port) : null, login ?? existing.login, password !== undefined ? password : undefined, req.params.id);
  const row = db.prepare('SELECT id, type, host, port, login, created_at FROM proxy WHERE id = ?').get(req.params.id);
  res.json(row);
});

router.delete('/:id', (req, res) => {
  const db = getDb();
  const r = db.prepare('DELETE FROM proxy WHERE id = ?').run(req.params.id);
  if (r.changes === 0) return res.status(404).json({ error: 'Прокси не найден' });
  res.status(204).send();
});

module.exports = router;
