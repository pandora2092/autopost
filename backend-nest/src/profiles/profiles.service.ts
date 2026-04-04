import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import type { Request } from 'express';
import { DatabaseService } from '../database/database.service';
import { VmManagerService } from '../vm/vm-manager.service';
import { v4 as uuidv4 } from 'uuid';

/** Базовый URL UI ws-scrcpy для браузера: явный STREAM_WEB_BASE или STREAM_WEB_RELATIVE + Host из запроса. */
function resolveStreamWebBase(req?: Request): string | undefined {
  const explicit = process.env.STREAM_WEB_BASE?.trim();
  if (explicit) return explicit.replace(/\/$/, '');

  const rel = process.env.STREAM_WEB_RELATIVE?.trim();
  if (!rel || !req) return undefined;

  const path = (rel.startsWith('/') ? rel : `/${rel}`).replace(/\/$/, '');

  const xfProtoRaw = req.headers['x-forwarded-proto'];
  const xfProto = (Array.isArray(xfProtoRaw) ? xfProtoRaw[0] : xfProtoRaw)?.split(',')[0]?.trim();
  const proto = xfProto || req.protocol || 'http';

  const xfHostRaw = req.headers['x-forwarded-host'];
  const host =
    (Array.isArray(xfHostRaw) ? xfHostRaw[0] : xfHostRaw)?.split(',')[0]?.trim() || req.get('host');
  if (!host) return undefined;

  return `${proto}://${host}${path}`;
}

export type SocialNetwork = 'instagram' | 'youtube' | 'vk';

function normalizeSocialNetwork(raw: string | undefined): SocialNetwork {
  if (raw === 'youtube') return 'youtube';
  if (raw === 'vk') return 'vk';
  return 'instagram';
}

function socialNetworkConflictLabel(sn: SocialNetwork): string {
  if (sn === 'youtube') return 'YouTube';
  if (sn === 'vk') return 'VK';
  return 'Instagram';
}

export interface CreateProfileDto {
  vm_id: string;
  instagram_username?: string;
  social_network?: SocialNetwork;
}

export interface UpdateProfileDto {
  instagram_username?: string;
  instagram_authorized?: boolean;
  social_network?: SocialNetwork;
}

@Injectable()
export class ProfilesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly vmManager: VmManagerService,
  ) {}

  findAll() {
    const db = this.db.getDb();
    const rows = db
      .prepare(
        `SELECT pr.id, pr.vm_id, pr.instagram_username, pr.social_network, pr.instagram_authorized, pr.created_at,
                v.name AS vm_name, v.adb_address, v.status AS vm_status, v.libvirt_domain
         FROM profile pr JOIN vm v ON v.id = pr.vm_id ORDER BY pr.created_at DESC`,
      )
      .all() as Array<{
      id: string;
      vm_id: string;
      instagram_username: string | null;
      social_network: string;
      instagram_authorized: number;
      created_at: string;
      vm_name: string;
      adb_address: string | null;
      vm_status: string;
      libvirt_domain: string;
    }>;

    const vmStatusById = new Map<string, string>();
    for (const row of rows) {
      if (vmStatusById.has(row.vm_id)) continue;
      let status = row.vm_status;
      if (row.libvirt_domain && status !== 'creating' && status !== 'error') {
        const real = this.vmManager.getDomainState(row.libvirt_domain);
        if (real !== status) {
          db.prepare('UPDATE vm SET status = ? WHERE id = ?').run(real, row.vm_id);
          status = real;
        }
      }
      vmStatusById.set(row.vm_id, status);
    }
    for (const row of rows) {
      row.vm_status = vmStatusById.get(row.vm_id) ?? row.vm_status;
      delete (row as { libvirt_domain?: string }).libvirt_domain;
    }
    return rows;
  }

  findOne(id: string) {
    const row = this.db.getDb()
      .prepare(
        `SELECT pr.*, v.name AS vm_name, v.adb_address, v.status AS vm_status, v.libvirt_domain, v.mac
         FROM profile pr JOIN vm v ON v.id = pr.vm_id WHERE pr.id = ?`,
      )
      .get(id);
    if (!row) throw new NotFoundException('Профиль не найден');
    return row;
  }

  create(dto: CreateProfileDto) {
    if (!dto.vm_id) throw new Error('vm_id обязателен');
    const db = this.db.getDb();
    const socialNetwork = normalizeSocialNetwork(dto.social_network);
    const existing = db
      .prepare('SELECT id FROM profile WHERE vm_id = ? AND social_network = ?')
      .get(dto.vm_id, socialNetwork);
    if (existing) {
      throw new ConflictException(`Профиль ${socialNetworkConflictLabel(socialNetwork)} для этой VM уже существует`);
    }
    const vmExists = db.prepare('SELECT id FROM vm WHERE id = ?').get(dto.vm_id);
    if (!vmExists) throw new NotFoundException('VM не найдена');
    const id = uuidv4();
    db.prepare(
      'INSERT INTO profile (id, vm_id, instagram_username, instagram_authorized, social_network) VALUES (?, ?, ?, ?, ?)',
    ).run(id, dto.vm_id, dto.instagram_username ?? null, 0, socialNetwork);
    return this.findOne(id);
  }

  update(id: string, dto: UpdateProfileDto) {
    this.findOne(id);
    const db = this.db.getDb();
    if (dto.instagram_username !== undefined)
      db.prepare('UPDATE profile SET instagram_username = ? WHERE id = ?').run(dto.instagram_username, id);
    if (dto.instagram_authorized !== undefined)
      db.prepare('UPDATE profile SET instagram_authorized = ? WHERE id = ?').run(dto.instagram_authorized ? 1 : 0, id);
    if (dto.social_network !== undefined) {
      const sn = normalizeSocialNetwork(dto.social_network);
      const current = db.prepare('SELECT vm_id FROM profile WHERE id = ?').get(id) as { vm_id: string } | undefined;
      if (current) {
        const clash = db
          .prepare('SELECT id FROM profile WHERE vm_id = ? AND social_network = ? AND id != ?')
          .get(current.vm_id, sn, id);
        if (clash) {
          throw new ConflictException(`Профиль ${socialNetworkConflictLabel(sn)} для этой VM уже существует`);
        }
      }
      db.prepare('UPDATE profile SET social_network = ? WHERE id = ?').run(sn, id);
    }
    return this.findOne(id);
  }

  remove(id: string) {
    const r = this.db.getDb().prepare('DELETE FROM profile WHERE id = ?').run(id);
    if (r.changes === 0) throw new NotFoundException('Профиль не найден');
  }

  getStreamUrl(id: string, req?: Request) {
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
    const streamWebBase = resolveStreamWebBase(req);
    if (streamWebBase) {
      const base = streamWebBase;
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

  clearMedia(id: string) {
    const profile = this.findOne(id) as {
      adb_address: string | null;
      libvirt_domain: string;
      mac: string | null;
      vm_status: string;
    };
    if (profile.vm_status !== 'running') {
      throw new BadRequestException('Запустите VM перед очисткой медиа.');
    }
    let adbAddress = profile.adb_address;
    if (!adbAddress) {
      const ip = this.vmManager.getVmIp(profile.libvirt_domain, profile.mac);
      if (ip) adbAddress = `${ip}:5555`;
    }
    if (!adbAddress) {
      throw new BadRequestException('Не удаётся определить адрес ADB. Укажите adb_address (IP:5555) в настройках VM.');
    }
    try {
      const { remote_dir } = this.vmManager.clearRemoteMediaDir(adbAddress);
      return { ok: true, remote_dir };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new BadRequestException(msg || 'Не удалось очистить папку с медиа');
    }
  }
}
