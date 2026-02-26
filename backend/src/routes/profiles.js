const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/client');

const router = express.Router();

router.get('/', (req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT pr.id, pr.vm_id, pr.instagram_username, pr.instagram_authorized, pr.created_at,
           v.name AS vm_name, v.adb_address, v.status AS vm_status
    FROM profile pr
    JOIN vm v ON v.id = pr.vm_id
    ORDER BY pr.created_at DESC
  `).all();
  res.json(rows);
});

router.post('/', (req, res) => {
  const { vm_id, instagram_username } = req.body;
  if (!vm_id) return res.status(400).json({ error: 'vm_id обязателен' });
  const db = getDb();
  const existing = db.prepare('SELECT id FROM profile WHERE vm_id = ?').get(vm_id);
  if (existing) return res.status(409).json({ error: 'Профиль для этой VM уже существует' });
  const vmExists = db.prepare('SELECT id FROM vm WHERE id = ?').get(vm_id);
  if (!vmExists) return res.status(404).json({ error: 'VM не найдена' });
  const id = uuidv4();
  db.prepare(
    'INSERT INTO profile (id, vm_id, instagram_username, instagram_authorized) VALUES (?, ?, ?, ?)'
  ).run(id, vm_id, instagram_username || null, 0);
  const row = db.prepare(`
    SELECT pr.id, pr.vm_id, pr.instagram_username, pr.instagram_authorized, pr.created_at,
           v.name AS vm_name, v.adb_address
    FROM profile pr JOIN vm v ON v.id = pr.vm_id WHERE pr.id = ?
  `).get(id);
  res.status(201).json(row);
});

router.get('/:id', (req, res) => {
  const db = getDb();
  const row = db.prepare(`
    SELECT pr.*, v.name AS vm_name, v.adb_address, v.status AS vm_status, v.libvirt_domain
    FROM profile pr JOIN vm v ON v.id = pr.vm_id WHERE pr.id = ?
  `).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Профиль не найден' });
  res.json(row);
});

router.patch('/:id', (req, res) => {
  const { instagram_username, instagram_authorized } = req.body;
  const db = getDb();
  const existing = db.prepare('SELECT id FROM profile WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Профиль не найден' });
  if (instagram_username !== undefined) {
    db.prepare('UPDATE profile SET instagram_username = ? WHERE id = ?').run(instagram_username, req.params.id);
  }
  if (instagram_authorized !== undefined) {
    db.prepare('UPDATE profile SET instagram_authorized = ? WHERE id = ?').run(instagram_authorized ? 1 : 0, req.params.id);
  }
  const row = db.prepare(`
    SELECT pr.id, pr.vm_id, pr.instagram_username, pr.instagram_authorized, pr.created_at,
           v.name AS vm_name, v.adb_address
    FROM profile pr JOIN vm v ON v.id = pr.vm_id WHERE pr.id = ?
  `).get(req.params.id);
  res.json(row);
});

router.delete('/:id', (req, res) => {
  const db = getDb();
  const r = db.prepare('DELETE FROM profile WHERE id = ?').run(req.params.id);
  if (r.changes === 0) return res.status(404).json({ error: 'Профиль не найден' });
  res.status(204).send();
});

/**
 * URL/инструкция для открытия экрана устройства (scrcpy).
 * Возвращает adb_address для подключения scrcpy -s <adb_address>.
 */
router.get('/:id/stream-url', (req, res) => {
  const db = getDb();
  const row = db.prepare(`
    SELECT pr.id, v.adb_address, v.libvirt_domain
    FROM profile pr JOIN vm v ON v.id = pr.vm_id WHERE pr.id = ?
  `).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Профиль не найден' });
  const vmManager = require('../services/vmManager');
  let adbAddress = row.adb_address;
  if (!adbAddress) {
    const ip = vmManager.getVmIp(row.libvirt_domain);
    if (ip) adbAddress = `${ip}:5555`;
  }
  if (!adbAddress) {
    return res.json({
      ok: false,
      instruction: 'Запустите VM и укажите adb_address (IP:5555) в настройках VM. Затем откройте экран снова.',
    });
  }
  const port = req.app.get('scrcpyPortBase') || 27183;
  const streamPort = port + (req.params.id.split('-').pop().replace(/\D/g, '') || 0) % 1000;
  res.json({
    ok: true,
    adb_address: adbAddress,
    stream_port: streamPort,
    instruction: `Для просмотра экрана установите scrcpy и выполните: scrcpy -s ${adbAddress}`,
  });
});

module.exports = router;
