const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/client');
const vmManager = require('../services/vmManager');

const router = express.Router();

router.get('/', (req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT v.id, v.name, v.libvirt_domain, v.mac, v.proxy_id, v.adb_address, v.android_id, v.status, v.created_at,
           p.type AS proxy_type, p.host AS proxy_host, p.port AS proxy_port
    FROM vm v
    LEFT JOIN proxy p ON p.id = v.proxy_id
    ORDER BY v.created_at DESC
  `).all();
  res.json(rows);
});

router.post('/', async (req, res) => {
  const { name, proxy_id, mac } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'name обязателен' });
  }
  const libvirtName = name.trim().replace(/\s+/g, '-');
  const db = getDb();
  const existing = db.prepare('SELECT id FROM vm WHERE name = ? OR libvirt_domain = ?').get(libvirtName, libvirtName);
  if (existing) {
    return res.status(409).json({ error: 'VM с таким именем уже существует' });
  }
  db.prepare(
    'INSERT INTO vm (id, name, libvirt_domain, mac, proxy_id, status) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(uuidv4(), libvirtName, libvirtName, null, proxy_id || null, 'creating');
  const vmRow = db.prepare('SELECT * FROM vm WHERE libvirt_domain = ?').get(libvirtName);
  try {
    const newMac = mac || vmManager.generateMac();
    const { name: createdName, mac: createdMac } = vmManager.cloneVm(libvirtName, newMac);
    db.prepare('UPDATE vm SET mac = ?, status = ? WHERE id = ?').run(createdMac, 'stopped', vmRow.id);
    const updated = db.prepare('SELECT id, name, libvirt_domain, mac, proxy_id, adb_address, android_id, status, created_at FROM vm WHERE id = ?').get(vmRow.id);
    return res.status(201).json(updated);
  } catch (err) {
    db.prepare('UPDATE vm SET status = ? WHERE id = ?').run('error', vmRow.id);
    return res.status(500).json({ error: err.message || 'Ошибка клонирования VM' });
  }
});

router.get('/:id', (req, res) => {
  const db = getDb();
  const row = db.prepare(`
    SELECT v.*, p.type AS proxy_type, p.host AS proxy_host, p.port AS proxy_port
    FROM vm v LEFT JOIN proxy p ON p.id = v.proxy_id
    WHERE v.id = ?
  `).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'VM не найдена' });
  res.json(row);
});

router.post('/:id/start', (req, res) => {
  const db = getDb();
  const vm = db.prepare('SELECT id, libvirt_domain, status FROM vm WHERE id = ?').get(req.params.id);
  if (!vm) return res.status(404).json({ error: 'VM не найдена' });
  try {
    vmManager.startVm(vm.libvirt_domain);
    db.prepare('UPDATE vm SET status = ? WHERE id = ?').run('running', vm.id);
    res.json({ status: 'running' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/stop', (req, res) => {
  const db = getDb();
  const vm = db.prepare('SELECT id, libvirt_domain FROM vm WHERE id = ?').get(req.params.id);
  if (!vm) return res.status(404).json({ error: 'VM не найдена' });
  try {
    vmManager.stopVm(vm.libvirt_domain);
    db.prepare('UPDATE vm SET status = ? WHERE id = ?').run('stopped', vm.id);
    res.json({ status: 'stopped' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', (req, res) => {
  const db = getDb();
  const vm = db.prepare('SELECT id, libvirt_domain FROM vm WHERE id = ?').get(req.params.id);
  if (!vm) return res.status(404).json({ error: 'VM не найдена' });
  try {
    vmManager.removeVm(vm.libvirt_domain);
    db.prepare('DELETE FROM vm WHERE id = ?').run(vm.id);
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/set-android-id', (req, res) => {
  const db = getDb();
  const vm = db.prepare('SELECT id, adb_address, libvirt_domain FROM vm WHERE id = ?').get(req.params.id);
  if (!vm) return res.status(404).json({ error: 'VM не найдена' });
  let adbAddress = vm.adb_address;
  if (!adbAddress) {
    const ip = vmManager.getVmIp(vm.libvirt_domain);
    if (ip) adbAddress = `${ip}:5555`;
  }
  if (!adbAddress) {
    return res.status(400).json({ error: 'Не известен adb_address. Запустите VM и укажите adb_address (IP:5555).' });
  }
  try {
    const { android_id } = vmManager.setAndroidId(adbAddress, req.body.android_id);
    db.prepare('UPDATE vm SET android_id = ?, adb_address = ? WHERE id = ?').run(android_id, adbAddress, vm.id);
    res.json({ android_id, adb_address });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id', (req, res) => {
  const { adb_address, proxy_id } = req.body;
  const db = getDb();
  const existing = db.prepare('SELECT id FROM vm WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'VM не найдена' });
  if (adb_address !== undefined) {
    db.prepare('UPDATE vm SET adb_address = ? WHERE id = ?').run(adb_address, req.params.id);
  }
  if (proxy_id !== undefined) {
    db.prepare('UPDATE vm SET proxy_id = ? WHERE id = ?').run(proxy_id, req.params.id);
  }
  const row = db.prepare('SELECT id, name, libvirt_domain, mac, proxy_id, adb_address, android_id, status, created_at FROM vm WHERE id = ?').get(req.params.id);
  res.json(row);
});

module.exports = router;
