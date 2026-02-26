import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { v4 as uuidv4 } from 'uuid';

export interface CreateProxyDto {
  type: string;
  host: string;
  port: number;
  login?: string;
  password?: string;
}

export interface UpdateProxyDto {
  type?: string;
  host?: string;
  port?: number;
  login?: string;
  password?: string;
}

@Injectable()
export class ProxyService {
  constructor(private readonly db: DatabaseService) {}

  findAll() {
    return this.db.getDb()
      .prepare('SELECT id, type, host, port, login, created_at FROM proxy ORDER BY created_at DESC')
      .all();
  }

  findOne(id: string) {
    const row = this.db.getDb()
      .prepare('SELECT id, type, host, port, login, created_at FROM proxy WHERE id = ?')
      .get(id);
    if (!row) throw new NotFoundException('Прокси не найден');
    return row;
  }

  create(dto: CreateProxyDto) {
    const { type, host, port, login, password } = dto;
    if (!type || !host || port == null) throw new Error('type, host, port обязательны');
    const id = uuidv4();
    this.db.getDb()
      .prepare('INSERT INTO proxy (id, type, host, port, login, password) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, type, host, Number(port), login ?? null, password ?? null);
    return this.findOne(id);
  }

  update(id: string, dto: UpdateProxyDto) {
    const existing = this.db.getDb().prepare('SELECT id, login FROM proxy WHERE id = ?').get(id);
    if (!existing) throw new NotFoundException('Прокси не найден');
    const { type, host, port, login, password } = dto;
    this.db.getDb()
      .prepare(
        'UPDATE proxy SET type = COALESCE(?, type), host = COALESCE(?, host), port = COALESCE(?, port), login = ?, password = ? WHERE id = ?',
      )
      .run(
        type ?? null,
        host ?? null,
        port != null ? Number(port) : null,
        login ?? (existing as { login: string }).login,
        password !== undefined ? password : undefined,
        id,
      );
    return this.findOne(id);
  }

  remove(id: string) {
    const r = this.db.getDb().prepare('DELETE FROM proxy WHERE id = ?').run(id);
    if (r.changes === 0) throw new NotFoundException('Прокси не найден');
  }
}
