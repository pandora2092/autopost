import { Injectable } from '@nestjs/common';
import { execSync, spawnSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

@Injectable()
export class VmManagerService {
  private readonly scriptsDir =
    process.env.SCRIPTS_DIR || path.resolve(__dirname, '../../../scripts');
  private readonly templateDomain = process.env.VM_TEMPLATE_DOMAIN || 'android-template';

  /** После смены density перезапускаем процессы — иначе VK/YouTube держат старый Configuration. */
  private readonly densityAwarePackagesDefault = [
    'com.instagram.android',
    'com.google.android.youtube',
    'com.vkontakte.android',
  ] as const;

  private run(cmd: string, options: { timeout?: number } = {}) {
    return execSync(cmd, { encoding: 'utf8', timeout: options.timeout ?? 120000 });
  }

  /** adb shell <args...> без исключения при ненулевом коде (для wm/settings). */
  private adbShellSpawn(
    adbAddress: string,
    shellArgs: string[],
    timeoutMs: number,
  ): { code: number | null; out: string } {
    const r = spawnSync('adb', ['-s', adbAddress, 'shell', ...shellArgs], {
      encoding: 'utf8',
      timeout: timeoutMs,
    });
    const out = `${r.stdout || ''}${r.stderr || ''}`.trim();
    return { code: r.status, out };
  }

  private parseWmDensityReport(text: string): { physical: number | null; override: number | null } {
    const physical =
      text.match(/Physical density:\s*(\d+)/i)?.[1] ??
      text.match(/Физическая[^:]{0,40}:\s*(\d+)/i)?.[1];
    const override = text.match(/Override density:\s*(\d+)/i)?.[1] ?? text.match(/Переопредел[^:]{0,40}:\s*(\d+)/i)?.[1];
    return {
      physical: physical ? parseInt(physical, 10) : null,
      override: override ? parseInt(override, 10) : null,
    };
  }

  private getPropLcdDensity(adbAddress: string): number | null {
    const { code, out } = this.adbShellSpawn(adbAddress, ['getprop', 'ro.sf.lcd_density'], 10000);
    if (code !== 0) return null;
    const m = out.match(/^\s*(\d+)\s*$/);
    return m ? parseInt(m[1], 10) : null;
  }

  /**
   * После adb root adbd перезапускается — переподключаемся.
   * VK_DISPLAY_ADB_ROOT=0 — не вызывать root (production-сборки без root).
   */
  private adbTryRootAndReconnect(adbAddress: string): boolean {
    if (process.env.VK_DISPLAY_ADB_ROOT === '0' || process.env.VK_DISPLAY_ADB_ROOT === 'false') {
      return false;
    }
    const r = spawnSync('adb', ['-s', adbAddress, 'root'], { encoding: 'utf8', timeout: 25000 });
    if (r.status !== 0) {
      console.warn('applyDisplayDensity: adb root не удался:', (r.stderr || r.stdout || '').trim());
      return false;
    }
    spawnSync('sleep', ['2'], { timeout: 5000 });
    this.adbConnect(adbAddress);
    return true;
  }

  /**
   * Как в «Настройки → Display size»: и wm, и display_density_forced должны совпадать.
   * Отключить запись в Settings (если на образе ломает масштаб): DISPLAY_DENSITY_SYNC_SETTINGS=0
   */
  private displayDensityShouldSyncSettings(): boolean {
    const v = (process.env.DISPLAY_DENSITY_SYNC_SETTINGS || '').toLowerCase();
    if (v === '0' || v === 'false' || v === 'no') return false;
    if (v === '1' || v === 'true' || v === 'yes') return true;
    return true;
  }

  private forceStopDensityAwareApps(adbAddress: string, logPrefix: string): void {
    const off = (process.env.DISPLAY_DENSITY_FORCE_STOP_APPS || '').toLowerCase();
    if (off === '0' || off === 'false' || off === 'no') return;
    const raw = (process.env.DISPLAY_DENSITY_FORCE_STOP_PACKAGES || '').trim();
    const pkgs = raw
      ? raw.split(',').map((p) => p.trim()).filter(Boolean)
      : [...this.densityAwarePackagesDefault];
    const timeout = 15000;
    for (const pkg of pkgs) {
      const r = this.adbShellSpawn(adbAddress, ['am', 'force-stop', pkg], timeout);
      if (r.code !== 0) {
        console.warn(logPrefix, 'am force-stop', pkg, r.out || `exit ${r.code}`);
      }
    }
    spawnSync('sleep', ['1'], { timeout: 2000 });
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

  /**
   * Пути к .qcow2 из XML домена (virsh dumpxml): <source file='...'/> в т.ч. относительные имена клона
   * (android-template-clone-1.qcow2 и т.п.), не зависят от формата domblklist.
   */
  private getDomainDiskPaths(domainName: string): string[] {
    const imagesDir = path.resolve(process.env.VM_LIBVIRT_IMAGES_DIR || '/var/lib/libvirt/images');
    try {
      const xml = this.run(`virsh dumpxml "${domainName}" 2>/dev/null`, { timeout: 30000 });
      const seen = new Set<string>();
      const re = /<source\s+file\s*=\s*(['"])([^'"]*)\1/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(xml)) !== null) {
        const raw = (m[2] || '').trim();
        if (!raw.endsWith('.qcow2')) continue;
        const abs = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(imagesDir, raw);
        if (!abs.startsWith(imagesDir + path.sep)) continue;
        seen.add(abs);
      }
      return [...seen];
    } catch (_) {
      return [];
    }
  }

  /**
   * Удаление .qcow2: сначала от имени процесса, при EACCES/EPERM — sudo rm (диски libvirt часто root:root).
   * Для безпарольного sudo: NOPASSWD на rm с путём под VM_LIBVIRT_IMAGES_DIR, либо запуск сервиса от root.
   */
  private removeDiskFile(diskPath: string): void {
    if (!fs.existsSync(diskPath)) return;
    try {
      fs.unlinkSync(diskPath);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== 'EACCES' && code !== 'EPERM') {
        console.warn(`removeVm: не удалось удалить диск ${diskPath}:`, (err as Error)?.message);
        return;
      }
    }
    if (process.env.VM_DISK_DELETE_NO_SUDO === '1') {
      console.warn(`removeVm: нет прав на ${diskPath}, задайте права на файлы или sudoers (см. VM_DISK_DELETE_NO_SUDO)`);
      return;
    }
    const r = spawnSync('sudo', ['-n', 'rm', '-f', '--', diskPath], {
      encoding: 'utf8',
      timeout: 60000,
    });
    if (r.status !== 0 || fs.existsSync(diskPath)) {
      console.warn(
        `removeVm: sudo rm не удалил ${diskPath} (status=${r.status}, stderr=${r.stderr || ''}). Нужен NOPASSWD sudo для rm или пользователь с правом записи в каталог образов.`,
      );
    }
  }

  removeVm(domainName: string): { removed: boolean } {
    let diskPaths: string[] = [];
    try {
      diskPaths = this.getDomainDiskPaths(domainName);
    } catch (_) {}

    try {
      this.run(`virsh destroy "${domainName}" 2>/dev/null || true`);
    } catch (_) {}
    try {
      this.run(`virsh undefine "${domainName}"`);
    } catch (_) {
      // домен мог быть удалён ранее (напр. через Cockpit)
    }

    for (const diskPath of diskPaths) {
      this.removeDiskFile(diskPath);
    }
    return { removed: true };
  }

  getVmIp(domainName: string, mac?: string | null): string | null {
    try {
      const out = this.run(`virsh domifaddr "${domainName}" 2>/dev/null`);
      const line = out.split('\n').find((l) => l.includes('ipv4'));
      if (line) {
        const m = line.match(/(\d+\.\d+\.\d+\.\d+)/);
        if (m) return m[1];
      }
    } catch (_) {}
    if (mac) {
      const fromDhcp = this.getIpFromDhcpLeases(mac);
      if (fromDhcp) return fromDhcp;
    }
    return null;
  }

  /** IP из аренд DHCP libvirt (для Android VM без guest agent). */
  getIpFromDhcpLeases(mac: string): string | null {
    if (!mac || !mac.match(/^[0-9a-fA-F:]+$/)) return null;
    const net = process.env.VIRSH_NETWORK || 'default';
    try {
      const out = this.run(`virsh net-dhcp-leases "${net}" 2>/dev/null`, { timeout: 5000 });
      const macLower = mac.toLowerCase();
      for (const line of out.split('\n').slice(2)) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 4) continue;
        if ((parts[1] || '').toLowerCase() !== macLower) continue;
        const ipPart = parts[3] || parts[4] || '';
        const m = ipPart.match(/^(\d+\.\d+\.\d+\.\d+)/);
        if (m) return m[1];
      }
    } catch (_) {}
    return null;
  }

  /**
   * Перед Appium: плотность как в системных настройках.
   * - **wm density** + при необходимости **settings {secure,global} display_density_forced** (одно значение с wm).
   * - Затем **am force-stop** Instagram / YouTube / VK — иначе часть приложений не перечитывает Configuration
   *   (остаётся layout «как до смены», в отличие от ручного Display size).
   * DISPLAY_DENSITY_SYNC_SETTINGS=0 — не писать в Settings (старый обход для кривых образов).
   * DISPLAY_DENSITY_FORCE_STOP_APPS=0 — не убивать процессы.
   * DISPLAY_DENSITY_FORCE_STOP_PACKAGES — свои пакеты через запятую.
   * VK: по умолчанию **210** DPI (как VK_WM_DENSITY=210); переопределение — VK_WM_DENSITY, расчёт от physical — VK_WM_DENSITY=auto.
   * YouTube: YOUTUBE_WM_DENSITY (по умолчанию 120). Root: VK_DISPLAY_ADB_ROOT=0 отключает.
   */
  applyDisplayDensity(adbAddress: string, mode: 'default' | 'vk_larger' | 'youtube'): void {
    this.adbConnect(adbAddress);
    if (!this.isAdbReady(adbAddress)) {
      console.warn('applyDisplayDensity: ADB не готов', adbAddress);
      return;
    }
    const timeout = 20000;
    const logPrefix = 'applyDisplayDensity:';

    const applyForcedSetting = (target: number | null) => {
      if (target == null) {
        this.adbShellSpawn(adbAddress, ['settings', 'delete', 'secure', 'display_density_forced'], timeout);
        this.adbShellSpawn(adbAddress, ['settings', 'delete', 'global', 'display_density_forced'], timeout);
        return;
      }
      let r = this.adbShellSpawn(
        adbAddress,
        ['settings', 'put', 'secure', 'display_density_forced', String(target)],
        timeout,
      );
      if (r.code !== 0) {
        r = this.adbShellSpawn(
          adbAddress,
          ['settings', 'put', 'global', 'display_density_forced', String(target)],
          timeout,
        );
      }
      if (r.code !== 0) {
        console.warn(logPrefix, 'settings display_density_forced:', r.out || `exit ${r.code}`);
      }
    };

    const wmDensitySet = (dpi: number | 'reset'): boolean => {
      const args = dpi === 'reset' ? ['wm', 'density', 'reset'] : ['wm', 'density', String(dpi)];
      const r = this.adbShellSpawn(adbAddress, args, timeout);
      if (r.code !== 0) {
        console.warn(logPrefix, args.join(' '), 'failed:', r.out || `exit ${r.code}`);
        return false;
      }
      return true;
    };

    const readWmDensity = () => {
      const r = this.adbShellSpawn(adbAddress, ['wm', 'density'], timeout);
      return this.parseWmDensityReport(r.out);
    };

    if (mode === 'default') {
      wmDensitySet('reset');
      applyForcedSetting(null);
      this.forceStopDensityAwareApps(adbAddress, logPrefix);
      return;
    }

    let target: number;
    const syncSettingsDensity = this.displayDensityShouldSyncSettings();

    if (mode === 'youtube') {
      wmDensitySet('reset');
      applyForcedSetting(null);
      const ytRaw = (process.env.YOUTUBE_WM_DENSITY || '120').trim();
      target = /^\d+$/.test(ytRaw) ? parseInt(ytRaw, 10) : 120;
    } else {
      wmDensitySet('reset');
      applyForcedSetting(null);
      const vkRaw = (process.env.VK_WM_DENSITY || '210').trim();
      const vkLower = vkRaw.toLowerCase();
      if (vkLower === 'auto' || vkLower === 'delta') {
        wmDensitySet('reset');
        applyForcedSetting(null);
        let { physical } = readWmDensity();
        if (physical == null) physical = this.getPropLcdDensity(adbAddress);
        if (physical == null) physical = 420;
        const delta = parseInt(process.env.VK_DISPLAY_DENSITY_DELTA || '-96', 10);
        const minDpi = parseInt(process.env.VK_DISPLAY_DENSITY_MIN || '72', 10);
        const maxDpi = parseInt(process.env.VK_DISPLAY_DENSITY_MAX || '800', 10);
        target = Math.max(minDpi, Math.min(maxDpi, physical + delta));
      } else if (/^\d+$/.test(vkRaw)) {
        wmDensitySet('reset');
        applyForcedSetting(null);
        target = parseInt(vkRaw, 10);
      } else {
        console.warn(logPrefix, 'VK_WM_DENSITY не число, используем 210:', vkRaw);
        wmDensitySet('reset');
        applyForcedSetting(null);
        target = 210;
      }
    }

    const tryApply = (): boolean => {
      if (!wmDensitySet(target)) return false;
      if (syncSettingsDensity) {
        applyForcedSetting(target);
      }
      const { override } = readWmDensity();
      if (override != null && Math.abs(override - target) > 2) {
        console.warn(logPrefix, `Override density ${override} ≠ целевой ${target}, пробуем root или проверьте права shell`);
        return false;
      }
      return true;
    };

    let applied = tryApply();
    if (!applied && this.adbTryRootAndReconnect(adbAddress) && this.isAdbReady(adbAddress)) {
      applied = tryApply();
    }
    if (!applied) {
      console.warn(
        logPrefix,
        'wm density не сработал; для QEMU/Android-x86 часто нужен root (userdebug), либо проверьте VK_WM_DENSITY / YOUTUBE_WM_DENSITY вручную: adb shell wm density',
      );
      return;
    }
    this.forceStopDensityAwareApps(adbAddress, logPrefix);
  }

  /** Проверяет, что устройство доступно по ADB (Android часто не отвечает на ping). */
  private isAdbReady(adbAddress: string): boolean {
    try {
      this.run(`adb -s ${adbAddress} shell true`, { timeout: 10000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Запускает VM и ждёт появления IP (domifaddr или DHCP по MAC), затем доступности по ADB. Возвращает adb_address.
   * mac — для получения IP из virsh net-dhcp-leases, если domifaddr не срабатывает (Android без guest agent).
   */
  async startVmAndWaitReady(domainName: string, mac?: string | null): Promise<{ ip: string; adb_address: string }> {
    const timeoutMs = parseInt(process.env.VM_START_TIMEOUT_MS || '180000', 10);
    const pollIntervalMs = parseInt(process.env.VM_START_POLL_INTERVAL_MS || '5000', 10);
    const postIpDelayMs = parseInt(process.env.VM_START_POST_IP_DELAY_MS || '15000', 10);
    const adbReadyTimeoutMs = parseInt(process.env.VM_START_ADB_READY_TIMEOUT_MS || '120000', 10);

    const state = this.getDomainState(domainName);
    if (state !== 'running') {
      this.startVm(domainName);
    }

    let ip: string | null = null;
    const deadlineIp = Date.now() + timeoutMs;
    while (Date.now() < deadlineIp) {
      ip = this.getVmIp(domainName, mac);
      if (ip) break;
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }
    if (!ip) throw new Error(`VM ${domainName}: не удалось получить IP за ${timeoutMs / 1000} с`);

    await new Promise((r) => setTimeout(r, postIpDelayMs));

    const adbAddress = `${ip}:5555`;
    const deadlineAdb = Date.now() + adbReadyTimeoutMs;
    while (Date.now() < deadlineAdb) {
      this.adbConnect(adbAddress);
      if (this.isAdbReady(adbAddress)) return { ip, adb_address: adbAddress };
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }
    throw new Error(`VM ${domainName}: IP ${ip} получен, но ADB не отвечает за ${adbReadyTimeoutMs / 1000} с (проверьте, что ADB включён на устройстве)`);
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

  /** Подмена ro.product.manufacturer и ro.product.model (чтобы не светить QEMU). Вызывается при «Настроить конфигурацию». */
  setDeviceProps(adbAddress: string): void {
    const script = path.join(this.scriptsDir, 'set-device-props.sh');
    if (!fs.existsSync(script)) return;
    try {
      this.run(`"${script}" "${adbAddress}"`, { timeout: 15000 });
    } catch (err) {
      console.warn('set-device-props failed:', (err as Error)?.message);
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

  /** Установка YouTube APK на устройство по adb_address (IP:port). Скрипт: install-youtube.sh, env YOUTUBE_APK. */
  installYoutube(adbAddress: string, apkPath?: string): { output: string } {
    const script = path.join(this.scriptsDir, 'install-youtube.sh');
    if (!fs.existsSync(script)) throw new Error(`Скрипт не найден: ${script}`);
    const args = [script, adbAddress];
    if (apkPath) args.push(apkPath);
    const out = this.run(args.map((a) => `"${a}"`).join(' '));
    return { output: out };
  }

  /** Установка VK (split APK). Скрипт: install-vk.sh, env VK_APK. */
  installVk(adbAddress: string, apkPath?: string): { output: string } {
    const script = path.join(this.scriptsDir, 'install-vk.sh');
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
   * Применяет прокси на устройстве.
   * - pushConfig=true: загружает redsocks.conf на устройство и запускает start-redsocks.sh (один раз, напр. при «Узнать IP»).
   * - pushConfig=false/undefined: только запускает start-redsocks.sh (конфиг уже на устройстве; при старте VM и перед публикацией).
   */
  /**
   * Удаляет содержимое папки с медиа на устройстве (по умолчанию /sdcard/Download).
   * Совпадает с REMOTE_MEDIA_DIR в публикации (env REMOTE_MEDIA_DIR).
   */
  clearRemoteMediaDir(adbAddress: string): { remote_dir: string } {
    const remoteDir = process.env.REMOTE_MEDIA_DIR || '/sdcard/Download';
    this.adbConnect(adbAddress);
    if (!this.isAdbReady(adbAddress)) {
      throw new Error('ADB не отвечает. Запустите VM и проверьте подключение.');
    }
    this.run(`adb -s ${adbAddress} shell mkdir -p ${remoteDir}`, { timeout: 15000 });
    this.run(`adb -s ${adbAddress} shell find ${remoteDir} -mindepth 1 -delete`, { timeout: 120000 });
    return { remote_dir: remoteDir };
  }

  applyProxy(
    adbAddress: string,
    proxy: { type: string; host: string; port: number; login?: string | null; password?: string | null },
    options?: { pushConfig?: boolean },
  ): void {
    const script = path.join(this.scriptsDir, 'apply-proxy.sh');
    if (!fs.existsSync(script)) {
      console.warn('apply-proxy.sh не найден, прокси не применён');
      return;
    }
    if (options?.pushConfig === true) {
      this.adbConnect(adbAddress);
    }
    const env = { ...process.env, ADB_TARGET: adbAddress };
    let args: string[];
    if (options?.pushConfig === true) {
      const type = proxy.type === 'http' ? 'http-connect' : proxy.type;
      args = [type, proxy.host, String(proxy.port)];
      if (proxy.login) args.push(proxy.login);
      if (proxy.password) args.push(proxy.password);
    } else {
      args = ['--run-only'];
    }
    try {
      const result = spawnSync(script, args, {
        encoding: 'utf8',
        timeout: 30000,
        env,
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
