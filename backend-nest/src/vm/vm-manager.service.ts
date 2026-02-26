import { Injectable } from '@nestjs/common';
import { execSync } from 'child_process';
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

  setAndroidId(adbAddress: string, androidId: string | null = null): { android_id: string } {
    const setScript = path.join(this.scriptsDir, 'set-android-id.sh');
    if (!fs.existsSync(setScript)) throw new Error(`Скрипт не найден: ${setScript}`);
    const args = androidId ? [setScript, adbAddress, androidId] : [setScript, adbAddress];
    const out = this.run(args.map((a) => `"${a}"`).join(' '));
    const m = out.match(/ANDROID_ID=(\S+)/);
    return { android_id: m ? m[1] : androidId || '' };
  }

  generateMac(): string {
    const parts = ['52', '54', '00'];
    for (let i = 0; i < 3; i++)
      parts.push(('0' + Math.floor(Math.random() * 256).toString(16)).slice(-2));
    return parts.join(':');
  }
}
