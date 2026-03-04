import { Injectable } from '@nestjs/common';
import { execSync, spawnSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

@Injectable()
export class VmManagerService {
  private readonly scriptsDir =
    process.env.SCRIPTS_DIR || path.resolve(__dirname, '../../../scripts');
  private readonly templateDomain = process.env.VM_TEMPLATE_DOMAIN || 'android-template';

  private run(cmd: string, options: { timeout?: number } = {}) {
    return execSync(cmd, { encoding: 'utf8', timeout: options.timeout ?? 120000 });
  }

  listDomains(): { id: string; name: string; state: string }[] {
    const out = this.run('virsh list --all');
    const lines = out.split('\n').filter(Boolean).slice(2);
    return lines.map((line) => {
      const parts = line.trim().split(/\s+/);
      const id = parts[0];
      const name = parts[1];
      const state = parts[2] === '-' ? 'shut' : parts.slice(2).join(' ');
      return { id, name, state: state === 'running' ? 'running' : 'stopped' };
    });
  }

  cloneVm(newName: string, mac: string | null = null): { name: string; mac: string } {
    const cloneScript = path.join(this.scriptsDir, 'clone-vm.sh');
    if (!fs.existsSync(cloneScript)) throw new Error(`Скрипт не найден: ${cloneScript}`);
    const args = [cloneScript, this.templateDomain, newName];
    if (mac) args.push(mac);
    const out = this.run(args.map((a) => `"${a}"`).join(' '));
    const parsed: Record<string, string> = {};
    out.split('\n').forEach((line) => {
      const m = line.match(/^(NEW_MAC|NEW_NAME)=(.*)$/);
      if (m) parsed[m[1]] = m[2].trim();
    });
    return { name: parsed.NEW_NAME || newName, mac: parsed.NEW_MAC || mac || '' };
  }

  startVm(domainName: string): { status: string } {
    this.run(`virsh start "${domainName}"`);
    return { status: 'running' };
  }

  stopVm(domainName: string): { status: string } {
    this.run(`virsh shutdown "${domainName}"`);
    return { status: 'stopped' };
  }

  /** Принудительное выключение (virsh destroy), если VM зависла. */
  forceStopVm(domainName: string): { status: string } {
    try {
      this.run(`virsh destroy "${domainName}" 2>/dev/null || true`, { timeout: 10000 });
    } catch (_) {}
    return { status: 'stopped' };
  }

  /** Реальный статус домена из libvirt (virsh domstate). */
  getDomainState(domainName: string): 'running' | 'stopped' {
    try {
      const out = this.run(`virsh domstate "${domainName}" 2>/dev/null`, { timeout: 5000 });
      const state = (out || '').trim().toLowerCase();
      return state === 'running' ? 'running' : 'stopped';
    } catch (_) {
      return 'stopped';
    }
  }

  removeVm(domainName: string): { removed: boolean } {
    try {
      this.run(`virsh destroy "${domainName}" 2>/dev/null || true`);
    } catch (_) {}
    this.run(`virsh undefine "${domainName}"`);
    return { removed: true };
  }

  getVmIp(domainName: string): string | null {
    try {
      const out = this.run(`virsh domifaddr "${domainName}" 2>/dev/null`);
      const line = out.split('\n').find((l) => l.includes('ipv4'));
      if (line) {
        const m = line.match(/(\d+\.\d+\.\d+\.\d+)/);
        if (m) return m[1];
      }
    } catch (_) {}
    return null;
  }

  /**
   * Запускает VM и ждёт появления IP (до таймаута). После получения IP — пауза (VM_START_POST_IP_DELAY_MS),
   * затем проверка доступности через ping. Возвращает adb_address (IP:5555) для использования в публикации.
   */
  /** Проверяет доступность хоста по ping (1 пакет, таймаут 3 с). */
  private pingHost(ip: string): boolean {
    try {
      this.run(`ping -c 1 -W 3 ${ip}`, { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  async startVmAndWaitReady(domainName: string): Promise<{ ip: string; adb_address: string }> {
    const timeoutMs = parseInt(process.env.VM_START_TIMEOUT_MS || '240000', 10);
    const pollIntervalMs = parseInt(process.env.VM_START_POLL_INTERVAL_MS || '15000', 10);
    const postIpDelayMs = parseInt(process.env.VM_START_POST_IP_DELAY_MS || '30000', 10);
    const pingTimeoutMs = parseInt(process.env.VM_START_PING_TIMEOUT_MS || '120000', 10);

    const state = this.getDomainState(domainName);
    if (state !== 'running') {
      this.startVm(domainName);
    }

    let ip: string | null = null;
    const deadlineIp = Date.now() + timeoutMs;
    while (Date.now() < deadlineIp) {
      ip = this.getVmIp(domainName);
      if (ip) break;
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }
    if (!ip) throw new Error(`VM ${domainName}: не удалось получить IP за ${timeoutMs / 1000} с`);

    await new Promise((r) => setTimeout(r, postIpDelayMs));

    const deadlinePing = Date.now() + pingTimeoutMs;
    while (Date.now() < deadlinePing) {
      if (this.pingHost(ip)) {
        const adbAddress = `${ip}:5555`;
        this.adbConnect(adbAddress);
        return { ip, adb_address: adbAddress };
      }
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }
    throw new Error(`VM ${domainName}: IP ${ip} получен, но хост не отвечает на ping за ${pingTimeoutMs / 1000} с`);
  }

  /** Подключает устройство по ADB (adb connect IP:5555). Вызывается при старте VM. */
  adbConnect(adbAddress: string): void {
    try {
      this.run(`adb connect ${adbAddress}`, { timeout: 10000 });
    } catch (err) {
      console.warn('adb connect %s failed:', adbAddress, (err as Error)?.message);
    }
  }

  setAndroidId(adbAddress: string, androidId: string | null = null): { android_id: string } {
    const setScript = path.join(this.scriptsDir, 'set-android-id.sh');
    if (!fs.existsSync(setScript)) throw new Error(`Скрипт не найден: ${setScript}`);
    const args = androidId ? [setScript, adbAddress, androidId] : [setScript, adbAddress];
    const out = this.run(args.map((a) => `"${a}"`).join(' '));
    const m = out.match(/ANDROID_ID=(\S+)/);
    return { android_id: m ? m[1] : androidId || '' };
  }

  /** Уникальный build fingerprint для клона (один раз на VM). */
  setBuildFingerprint(adbAddress: string): void {
    const script = path.join(this.scriptsDir, 'set-build-fingerprint.sh');
    if (!fs.existsSync(script)) return;
    try {
      this.run(`"${script}" "${adbAddress}"`, { timeout: 15000 });
    } catch (err) {
      console.warn('set-build-fingerprint failed:', (err as Error)?.message);
    }
  }

  /** Установка Instagram APK на устройство по adb_address (IP:port). */
  installInstagram(adbAddress: string, apkPath?: string): { output: string } {
    const script = path.join(this.scriptsDir, 'install-instagram.sh');
    if (!fs.existsSync(script)) throw new Error(`Скрипт не найден: ${script}`);
    const args = [script, adbAddress];
    if (apkPath) args.push(apkPath);
    const out = this.run(args.map((a) => `"${a}"`).join(' '));
    return { output: out };
  }

  generateMac(): string {
    const parts = ['52', '54', '00'];
    for (let i = 0; i < 3; i++)
      parts.push(('0' + Math.floor(Math.random() * 256).toString(16)).slice(-2));
    return parts.join(':');
  }

  /**
   * Применяет прокси на устройстве: загружает конфиг redsocks через apply-proxy.sh.
   * На устройстве должен быть запущен redsocks с чтением конфига из /data/local/tmp/redsocks.conf
   * и настроен iptables redirect. Тогда весь трафик (в т.ч. браузер) пойдёт через прокси.
   */
  applyProxy(
    adbAddress: string,
    proxy: { type: string; host: string; port: number; login?: string | null; password?: string | null },
  ): void {
    const script = path.join(this.scriptsDir, 'apply-proxy.sh');
    if (!fs.existsSync(script)) {
      console.warn('apply-proxy.sh не найден, прокси не применён');
      return;
    }
    const type = proxy.type === 'http' ? 'http-connect' : proxy.type;
    const args = [type, proxy.host, String(proxy.port)];
    if (proxy.login) args.push(proxy.login);
    if (proxy.password) args.push(proxy.password);
    try {
      const result = spawnSync(script, args, {
        encoding: 'utf8',
        timeout: 30000,
        env: { ...process.env, ADB_TARGET: adbAddress },
        cwd: this.scriptsDir,
      });
      if (result.status !== 0) {
        console.warn('applyProxy script exit', result.status, result.stderr || result.stdout);
      }
    } catch (err) {
      console.warn('applyProxy failed:', (err as Error)?.message);
    }
  }
}
