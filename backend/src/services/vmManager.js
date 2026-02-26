/**
 * Управление VM через virsh и скрипты клонирования.
 * Требует: virsh, скрипты в scripts/ (clone-vm.sh, set-android-id.sh, apply-proxy.sh).
 */

const { execSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const SCRIPTS_DIR = process.env.SCRIPTS_DIR || path.resolve(__dirname, '../../../scripts');
const TEMPLATE_DOMAIN = process.env.VM_TEMPLATE_DOMAIN || 'android-template';

function run(cmd, options = {}) {
  return execSync(cmd, { encoding: 'utf8', timeout: 120000, ...options });
}

function runAsync(cmd, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd[0], cmd.slice(1), { stdio: ['ignore', 'pipe', 'pipe'], ...options });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => { stdout += d; });
    child.stderr?.on('data', (d) => { stderr += d; });
    child.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr || stdout || `Exit ${code}`));
    });
    child.on('error', reject);
  });
}

/**
 * Список доменов libvirt (имя, состояние).
 */
function listDomains() {
  const out = run('virsh list --all');
  const lines = out.split('\n').filter(Boolean).slice(2);
  return lines.map((line) => {
    const parts = line.trim().split(/\s+/);
    const id = parts[0];
    const name = parts[1];
    const state = parts[2] === '-' ? 'shut' : parts.slice(2).join(' ');
    return { id, name, state: state === 'running' ? 'running' : 'stopped' };
  });
}

/**
 * Создать VM из шаблона (вызов clone-vm.sh).
 * Возвращает { name, mac }.
 */
function cloneVm(newName, mac = null) {
  const cloneScript = path.join(SCRIPTS_DIR, 'clone-vm.sh');
  if (!fs.existsSync(cloneScript)) {
    throw new Error(`Скрипт не найден: ${cloneScript}`);
  }
  const args = [cloneScript, TEMPLATE_DOMAIN, newName];
  if (mac) args.push(mac);
  const out = run(`bash ${args.map((a) => `"${a}"`).join(' ')}`);
  const parsed = {};
  out.split('\n').forEach((line) => {
    const m = line.match(/^(NEW_MAC|NEW_NAME)=(.*)$/);
    if (m) parsed[m[1]] = m[2].trim();
  });
  return { name: parsed.NEW_NAME || newName, mac: parsed.NEW_MAC || mac };
}

/**
 * Запуск VM по имени домена.
 */
function startVm(domainName) {
  run(`virsh start "${domainName}"`);
  return { status: 'running' };
}

/**
 * Остановка VM.
 */
function stopVm(domainName) {
  run(`virsh shutdown "${domainName}"`);
  return { status: 'stopped' };
}

/**
 * Удаление VM и её диска (destroy + undefine + удаление диска при возможности).
 */
function removeVm(domainName) {
  try {
    run(`virsh destroy "${domainName}" 2>/dev/null || true`);
  } catch (_) {}
  run(`virsh undefine "${domainName}"`);
  return { removed: true };
}

/**
 * Получить IP VM (через virsh domifaddr или qemu-agent, если доступен).
 */
function getVmIp(domainName) {
  try {
    const out = run(`virsh domifaddr "${domainName}" 2>/dev/null`);
    const line = out.split('\n').find((l) => l.includes('ipv4'));
    if (line) {
      const m = line.match(/(\d+\.\d+\.\d+\.\d+)/);
      if (m) return m[1];
    }
  } catch (_) {}
  return null;
}

/**
 * Установить Android ID на устройстве по adb_address (IP:port).
 */
function setAndroidId(adbAddress, androidId = null) {
  const setScript = path.join(SCRIPTS_DIR, 'set-android-id.sh');
  if (!fs.existsSync(setScript)) {
    throw new Error(`Скрипт не найден: ${setScript}`);
  }
  const args = androidId ? [setScript, adbAddress, androidId] : [setScript, adbAddress];
  const out = run(`bash ${args.map((a) => `"${a}"`).join(' ')}`);
  const m = out.match(/ANDROID_ID=(\S+)/);
  return { android_id: m ? m[1] : androidId };
}

/**
 * Сгенерировать случайный Android ID (16 hex).
 */
function generateAndroidId() {
  const hex = '0123456789abcdef';
  let id = '';
  for (let i = 0; i < 16; i++) id += hex[Math.floor(Math.random() * 16)];
  return id;
}

/**
 * Сгенерировать случайный MAC (52:54:00:xx:xx:xx).
 */
function generateMac() {
  const parts = ['52', '54', '00'];
  for (let i = 0; i < 3; i++) {
    parts.push(('0' + (Math.floor(Math.random() * 256)).toString(16)).slice(-2));
  }
  return parts.join(':');
}

module.exports = {
  listDomains,
  cloneVm,
  startVm,
  stopVm,
  removeVm,
  getVmIp,
  setAndroidId,
  generateAndroidId,
  generateMac,
  runAsync,
  TEMPLATE_DOMAIN,
  SCRIPTS_DIR,
};
