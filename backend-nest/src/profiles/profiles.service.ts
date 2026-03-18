import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { VmManagerService } from '../vm/vm-manager.service';
import { v4 as uuidv4 } from 'uuid';

export interface CreateProfileDto {
  vm_id: string;
  instagram_username?: string;
}

export interface UpdateProfileDto {
  instagram_username?: string;
  instagram_authorized?: boolean;
}

@Injectable()
export class ProfilesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly vmManager: VmManagerService,
  ) {}

  findAll() {
    return this.db.getDb()
      .prepare(
        `SELECT pr.id, pr.vm_id, pr.instagram_username, pr.instagram_authorized, pr.created_at,
                v.name AS vm_name, v.adb_address, v.status AS vm_status
         FROM profile pr JOIN vm v ON v.id = pr.vm_id ORDER BY pr.created_at DESC`,
      )
      .all();
  }

  findOne(id: string) {
    const row = this.db.getDb()
      .prepare(
        `SELECT pr.*, v.name AS vm_name, v.adb_address, v.status AS vm_status, v.libvirt_domain
         FROM profile pr JOIN vm v ON v.id = pr.vm_id WHERE pr.id = ?`,
      )
      .get(id);
    if (!row) throw new NotFoundException('Профиль не найден');
    return row;
  }

  create(dto: CreateProfileDto) {
    if (!dto.vm_id) throw new Error('vm_id обязателен');
    const db = this.db.getDb();
    const existing = db.prepare('SELECT id FROM profile WHERE vm_id = ?').get(dto.vm_id);
    if (existing) throw new ConflictException('Профиль для этой VM уже существует');
    const vmExists = db.prepare('SELECT id FROM vm WHERE id = ?').get(dto.vm_id);
    if (!vmExists) throw new NotFoundException('VM не найдена');
    const id = uuidv4();
    db.prepare(
      'INSERT INTO profile (id, vm_id, instagram_username, instagram_authorized) VALUES (?, ?, ?, ?)',
    ).run(id, dto.vm_id, dto.instagram_username ?? null, 0);
    return this.findOne(id);
  }

  update(id: string, dto: UpdateProfileDto) {
    this.findOne(id);
    const db = this.db.getDb();
    if (dto.instagram_username !== undefined)
      db.prepare('UPDATE profile SET instagram_username = ? WHERE id = ?').run(dto.instagram_username, id);
    if (dto.instagram_authorized !== undefined)
      db.prepare('UPDATE profile SET instagram_authorized = ? WHERE id = ?').run(dto.instagram_authorized ? 1 : 0, id);
    return this.findOne(id);
  }

  remove(id: string) {
    const r = this.db.getDb().prepare('DELETE FROM profile WHERE id = ?').run(id);
    if (r.changes === 0) throw new NotFoundException('Профиль не найден');
  }

  getStreamUrl(id: string) {
    const row = this.db.getDb()
      .prepare(
        'SELECT pr.id, v.adb_address, v.libvirt_domain, v.mac FROM profile pr JOIN vm v ON v.id = pr.vm_id WHERE pr.id = ?',
      )
      .get(id) as { id: string; adb_address: string | null; libvirt_domain: string; mac: string | null } | undefined;
    if (!row) throw new NotFoundException('Профиль не найден');
    let adbAddress = row.adb_address;
    if (!adbAddress) {
      const ip = this.vmManager.getVmIp(row.libvirt_domain, row.mac);
      if (ip) adbAddress = `${ip}:5555`;
    }
    if (!adbAddress) {
      return {
        ok: false,
        instruction:
          'Запустите VM и укажите adb_address (IP:5555) в настройках VM. Затем откройте экран снова.',
      };
    }
    // Ensure device is present in `adb devices` (needed for ws-scrcpy proxy-adb/adb forward).
    this.vmManager.adbConnect(adbAddress);
    const portBase = parseInt(process.env.SCRCPY_PORT_BASE || '27183', 10);
    const streamPort = portBase + (parseInt(id.split('-').pop()?.replace(/\D/g, '') || '0', 10) % 1000);
    const result: {
      ok: boolean;
      adb_address: string;
      stream_port: number;
      instruction: string;
      stream_web_url?: string;
    } = {
      ok: true,
      adb_address: adbAddress,
      stream_port: streamPort,
      instruction: `Для просмотра экрана установите scrcpy и выполните: scrcpy -s ${adbAddress}`,
    };
    const streamWebBase = process.env.STREAM_WEB_BASE?.trim();
    if (streamWebBase) {
      const base = streamWebBase.replace(/\/$/, '');
      // ws-scrcpy expects required params: action=stream, udid, player, ws (websocket url)
      // ws must point to ws-scrcpy websocket endpoint with action=proxy-adb.
      const httpUrl = new URL(base);
      const wsProto = httpUrl.protocol === 'https:' ? 'wss:' : 'ws:';
      const pathname = httpUrl.pathname || '/';
      const wsUrl = new URL(`${wsProto}//${httpUrl.host}${pathname}`);
      wsUrl.searchParams.set('action', 'proxy-adb');
      wsUrl.searchParams.set('remote', 'tcp:8886');
      wsUrl.searchParams.set('udid', adbAddress);

      const hash = new URLSearchParams();
      hash.set('action', 'stream');
      hash.set('udid', adbAddress);
      hash.set('player', 'broadway');
      hash.set('ws', wsUrl.toString());
      result.stream_web_url = `${base}/#!${hash.toString()}`;
    }
    return result;
  }
}
