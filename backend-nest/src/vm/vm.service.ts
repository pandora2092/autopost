import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { VmManagerService } from './vm-manager.service';
import { v4 as uuidv4 } from 'uuid';

export interface CreateVmDto {
  name: string;
  proxy_id?: string;
  mac?: string;
}

export interface UpdateVmDto {
  adb_address?: string;
  proxy_id?: string;
}

@Injectable()
export class VmService {
  constructor(
    private readonly db: DatabaseService,
    private readonly vmManager: VmManagerService,
  ) {}

  findAll() {
    const db = this.db.getDb();
    const rows = db.prepare(
      `SELECT v.id, v.name, v.libvirt_domain, v.mac, v.proxy_id, v.adb_address, v.android_id, v.status, v.instagram_installed, v.youtube_installed, v.created_at,
              p.type AS proxy_type, p.host AS proxy_host, p.port AS proxy_port
       FROM vm v LEFT JOIN proxy p ON p.id = v.proxy_id ORDER BY v.created_at DESC`,
    ).all() as { id: string; libvirt_domain: string; status: string }[];
    for (const v of rows) {
      if (v.libvirt_domain && v.status !== 'creating' && v.status !== 'error') {
        const real = this.vmManager.getDomainState(v.libvirt_domain);
        if (real !== v.status) {
          db.prepare('UPDATE vm SET status = ? WHERE id = ?').run(real, v.id);
          (v as { status: string }).status = real;
        }
      }
    }
    return rows;
  }

  findOne(id: string) {
    const row = this.db.getDb()
      .prepare(
        `SELECT v.*, p.type AS proxy_type, p.host AS proxy_host, p.port AS proxy_port
         FROM vm v LEFT JOIN proxy p ON p.id = v.proxy_id WHERE v.id = ?`,
      )
      .get(id);
    if (!row) throw new NotFoundException('VM не найдена');
    return row;
  }

  async create(dto: CreateVmDto) {
    const name = dto.name?.trim();
    if (!name) throw new Error('name обязателен');
    const libvirtName = name.replace(/\s+/g, '-');
    const db = this.db.getDb();
    const existing = db.prepare('SELECT id FROM vm WHERE name = ? OR libvirt_domain = ?').get(libvirtName, libvirtName);
    if (existing) throw new ConflictException('VM с таким именем уже существует');
    const id = uuidv4();
    db.prepare(
      'INSERT INTO vm (id, name, libvirt_domain, mac, proxy_id, status) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(id, libvirtName, libvirtName, null, dto.proxy_id ?? null, 'creating');
    const vmRow = db.prepare('SELECT * FROM vm WHERE libvirt_domain = ?').get(libvirtName) as { id: string };
    try {
      const newMac = dto.mac || this.vmManager.generateMac();
      const { mac: createdMac } = this.vmManager.cloneVm(libvirtName, newMac);
      db.prepare('UPDATE vm SET mac = ?, status = ? WHERE id = ?').run(createdMac, 'stopped', vmRow.id);
      return this.findOne(vmRow.id);
    } catch (err) {
      db.prepare('UPDATE vm SET status = ? WHERE id = ?').run('error', vmRow.id);
      throw err;
    }
  }

  update(id: string, dto: UpdateVmDto) {
    this.findOne(id);
    const db = this.db.getDb();
    if (dto.adb_address !== undefined) db.prepare('UPDATE vm SET adb_address = ? WHERE id = ?').run(dto.adb_address, id);
    if (dto.proxy_id !== undefined) db.prepare('UPDATE vm SET proxy_id = ? WHERE id = ?').run(dto.proxy_id, id);
    return this.findOne(id);
  }

  async start(id: string): Promise<{ status: string; firstStart?: boolean }> {
    const vm = this.db.getDb()
      .prepare('SELECT id, libvirt_domain, proxy_id, adb_address, mac FROM vm WHERE id = ?')
      .get(id) as { id: string; libvirt_domain: string; proxy_id: string | null; adb_address: string | null; mac: string | null } | undefined;
    if (!vm) throw new NotFoundException('VM не найдена');
    this.vmManager.startVm(vm.libvirt_domain);
    this.db.getDb().prepare("UPDATE vm SET status = ?, updated_at = datetime('now') WHERE id = ?").run('running', id);
    if (!vm.adb_address) {
      return { status: 'running', firstStart: true };
    }
    const { adb_address } = await this.vmManager.startVmAndWaitReady(vm.libvirt_domain, vm.mac);
    this.db.getDb().prepare("UPDATE vm SET adb_address = ?, updated_at = datetime('now') WHERE id = ?").run(adb_address, id);
    if (vm.proxy_id) {
      const proxy = this.db.getDb()
        .prepare('SELECT type, host, port, login, password FROM proxy WHERE id = ?')
        .get(vm.proxy_id) as { type: string; host: string; port: number; login: string | null; password: string | null } | undefined;
      if (proxy) this.vmManager.applyProxy(adb_address, proxy, { pushConfig: true });
    }
    return { status: 'running' };
  }

  stop(id: string) {
    const vm = this.db.getDb().prepare('SELECT id, libvirt_domain FROM vm WHERE id = ?').get(id) as { id: string; libvirt_domain: string } | undefined;
    if (!vm) throw new NotFoundException('VM не найдена');
    this.vmManager.forceStopVm(vm.libvirt_domain);
    const real = this.vmManager.getDomainState(vm.libvirt_domain);
    this.db.getDb().prepare('UPDATE vm SET status = ? WHERE id = ?').run(real, id);
    return { status: real };
  }

  remove(id: string) {
    const vm = this.db.getDb().prepare('SELECT id, libvirt_domain FROM vm WHERE id = ?').get(id) as { id: string; libvirt_domain: string } | undefined;
    if (!vm) throw new NotFoundException('VM не найдена');
    this.vmManager.removeVm(vm.libvirt_domain);
    this.db.getDb().prepare('DELETE FROM vm WHERE id = ?').run(id);
  }

  setAndroidId(id: string, androidId?: string) {
    const vm = this.db.getDb().prepare('SELECT id, adb_address, libvirt_domain FROM vm WHERE id = ?').get(id) as { id: string; adb_address: string | null; libvirt_domain: string } | undefined;
    if (!vm) throw new NotFoundException('VM не найдена');
    let adbAddress = vm.adb_address;
    if (!adbAddress) {
      const ip = this.vmManager.getVmIp(vm.libvirt_domain);
      if (ip) adbAddress = `${ip}:5555`;
    }
    if (!adbAddress) throw new Error('Не известен adb_address. Запустите VM и укажите adb_address (IP:5555).');
    const { android_id } = this.vmManager.setAndroidId(adbAddress, androidId ?? null);
    this.vmManager.setBuildFingerprint(adbAddress);
    this.vmManager.setDeviceProps(adbAddress);
    this.db.getDb().prepare('UPDATE vm SET android_id = ?, adb_address = ? WHERE id = ?').run(android_id, adbAddress, id);
    return { android_id, adb_address: adbAddress };
  }

  installInstagram(id: string, apkPath?: string) {
    const vm = this.db.getDb()
      .prepare('SELECT id, adb_address, libvirt_domain FROM vm WHERE id = ?')
      .get(id) as { id: string; adb_address: string | null; libvirt_domain: string } | undefined;
    if (!vm) throw new NotFoundException('VM не найдена');
    let adbAddress = vm.adb_address;
    if (!adbAddress) {
      const ip = this.vmManager.getVmIp(vm.libvirt_domain);
      if (ip) adbAddress = `${ip}:5555`;
    }
    if (!adbAddress) {
      throw new Error('Не известен adb_address. Запустите VM и укажите adb_address (IP:5555).');
    }
    const { output } = this.vmManager.installInstagram(adbAddress, apkPath);
    this.db.getDb().prepare('UPDATE vm SET instagram_installed = 1 WHERE id = ?').run(id);
    return { ok: true, adb_address: adbAddress, output };
  }

  installYoutube(id: string, apkPath?: string) {
    const vm = this.db.getDb()
      .prepare('SELECT id, adb_address, libvirt_domain FROM vm WHERE id = ?')
      .get(id) as { id: string; adb_address: string | null; libvirt_domain: string } | undefined;
    if (!vm) throw new NotFoundException('VM не найдена');
    let adbAddress = vm.adb_address;
    if (!adbAddress) {
      const ip = this.vmManager.getVmIp(vm.libvirt_domain);
      if (ip) adbAddress = `${ip}:5555`;
    }
    if (!adbAddress) {
      throw new Error('Не известен adb_address. Запустите VM и укажите adb_address (IP:5555).');
    }
    const { output } = this.vmManager.installYoutube(adbAddress, apkPath);
    this.db.getDb().prepare('UPDATE vm SET youtube_installed = 1 WHERE id = ?').run(id);
    return { ok: true, adb_address: adbAddress, output };
  }

  /** Применить прокси на устройстве VM (загрузка redsocks.conf по ADB). Трафик на устройстве пойдёт через прокси. */
  applyProxy(id: string, pushConfig = false): void {
    const vm = this.db.getDb()
      .prepare(
        `SELECT v.adb_address, v.libvirt_domain, v.proxy_id, p.type, p.host, p.port, p.login, p.password
         FROM vm v LEFT JOIN proxy p ON p.id = v.proxy_id WHERE v.id = ?`,
      )
      .get(id) as {
        adb_address: string | null;
        libvirt_domain: string;
        proxy_id: string | null;
        type: string | null;
        host: string | null;
        port: number | null;
        login: string | null;
        password: string | null;
      } | undefined;
    if (!vm) throw new NotFoundException('VM не найдена');
    if (!vm.proxy_id || !vm.host) throw new Error('У VM не задан прокси');
    let adbAddress = vm.adb_address;
    if (!adbAddress) {
      const ip = this.vmManager.getVmIp(vm.libvirt_domain);
      adbAddress = ip ? `${ip}:5555` : null;
    }
    if (!adbAddress) throw new Error('Не известен adb_address. Запустите VM и укажите adb_address (IP:5555).');
    this.vmManager.applyProxy(
      adbAddress,
      {
        type: vm.type!,
        host: vm.host!,
        port: vm.port!,
        login: vm.login,
        password: vm.password,
      },
      { pushConfig },
    );
  }

  /** Получить IP VM через virsh domifaddr и при желании сохранить как adb_address. При saveAdb=true и наличии прокси — раз загружает конфиг на устройство и запускает redsocks. */
  getVmIp(id: string, saveAdb = false): { ip: string | null; adb_address: string | null } {
    const vm = this.db.getDb()
      .prepare(
        `SELECT v.id, v.adb_address, v.libvirt_domain, v.proxy_id, p.type AS proxy_type, p.host AS proxy_host, p.port AS proxy_port, p.login AS proxy_login, p.password AS proxy_password
         FROM vm v LEFT JOIN proxy p ON p.id = v.proxy_id WHERE v.id = ?`,
      )
      .get(id) as {
        adb_address: string | null;
        libvirt_domain: string;
        proxy_id: string | null;
        proxy_type: string | null;
        proxy_host: string | null;
        proxy_port: number | null;
        proxy_login: string | null;
        proxy_password: string | null;
      } | undefined;
    if (!vm) throw new NotFoundException('VM не найдена');
    const ip = this.vmManager.getVmIp(vm.libvirt_domain);
    const adb_address = ip ? `${ip}:5555` : null;
    if (saveAdb && adb_address) {
      this.db.getDb().prepare('UPDATE vm SET adb_address = ? WHERE id = ?').run(adb_address, id);
      if (vm.proxy_id && vm.proxy_type != null && vm.proxy_host != null && vm.proxy_port != null) {
        this.vmManager.adbConnect(adb_address);
        this.vmManager.applyProxy(adb_address, {
          type: vm.proxy_type,
          host: vm.proxy_host,
          port: vm.proxy_port,
          login: vm.proxy_login ?? undefined,
          password: vm.proxy_password ?? undefined,
        }, { pushConfig: true });
      }
    }
    return { ip: ip ?? null, adb_address: adb_address ?? vm.adb_address };
  }
}
