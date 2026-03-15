import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { UploadService } from '../upload/upload.service';
import { v4 as uuidv4 } from 'uuid';

export interface CreatePostDto {
  profile_id: string;
  media_path: string;
  caption?: string;
  scheduled_at?: string;
}

export interface UpdatePostDto {
  status?: string;
  scheduled_at?: string;
  caption?: string;
}

@Injectable()
export class PostsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly uploadService: UploadService,
  ) {}

  findAll(status?: string, profile_id?: string) {
    let sql = `
      SELECT s.id, s.profile_id, s.media_path, s.caption, s.scheduled_at, s.status, s.assigned_at, s.published_at, s.post_url, s.error_message, s.created_at,
             pr.instagram_username, v.name AS vm_name
      FROM scheduled_post s
      JOIN profile pr ON pr.id = s.profile_id
      JOIN vm v ON v.id = pr.vm_id
      WHERE 1=1
    `;
    const params: (string | number)[] = [];
    if (status) {
      sql += ' AND s.status = ?';
      params.push(status);
    }
    if (profile_id) {
      sql += ' AND s.profile_id = ?';
      params.push(profile_id);
    }
    sql += ' ORDER BY s.scheduled_at DESC';
    return this.db.getDb().prepare(sql).all(...params);
  }

  findOne(id: string) {
    const row = this.db.getDb()
      .prepare(
        `SELECT s.*, pr.instagram_username, pr.vm_id, v.name AS vm_name
         FROM scheduled_post s
         JOIN profile pr ON pr.id = s.profile_id
         JOIN vm v ON v.id = pr.vm_id
         WHERE s.id = ?`,
      )
      .get(id);
    if (!row) throw new NotFoundException('Пост не найден');
    return row;
  }

  create(dto: CreatePostDto) {
    if (!dto.profile_id || !dto.media_path) throw new Error('profile_id и media_path обязательны');
    const db = this.db.getDb();
    const profile = db.prepare('SELECT id FROM profile WHERE id = ?').get(dto.profile_id);
    if (!profile) throw new NotFoundException('Профиль не найден');
    const id = uuidv4();
    const at = dto.scheduled_at || new Date().toISOString();
    db.prepare(
      'INSERT INTO scheduled_post (id, profile_id, media_path, caption, scheduled_at, status) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(id, dto.profile_id, dto.media_path, dto.caption ?? null, at, 'pending');
    return this.findOne(id);
  }

  update(id: string, dto: UpdatePostDto) {
    this.findOne(id);
    const db = this.db.getDb();
    if (dto.status !== undefined) {
      if (dto.status === 'pending') {
        db.prepare("UPDATE scheduled_post SET status = ?, error_message = NULL, updated_at = datetime('now') WHERE id = ?").run(dto.status, id);
      } else {
        db.prepare("UPDATE scheduled_post SET status = ?, updated_at = datetime('now') WHERE id = ?").run(dto.status, id);
      }
    }
    if (dto.scheduled_at !== undefined)
      db.prepare("UPDATE scheduled_post SET scheduled_at = ?, updated_at = datetime('now') WHERE id = ?").run(dto.scheduled_at, id);
    if (dto.caption !== undefined)
      db.prepare("UPDATE scheduled_post SET caption = ?, updated_at = datetime('now') WHERE id = ?").run(dto.caption, id);
    return this.findOne(id);
  }

  cancel(id: string) {
    const r = this.db.getDb().prepare('UPDATE scheduled_post SET status = ? WHERE id = ?').run('cancelled', id);
    if (r.changes === 0) throw new NotFoundException('Пост не найден');
    return { status: 'cancelled' };
  }

  clearAll(): { deleted: number; filesDeleted: number } {
    const db = this.db.getDb();
    const r = db.prepare('DELETE FROM scheduled_post').run();
    const filesDeleted = this.uploadService.clearAllMp4();
    return { deleted: r.changes, filesDeleted };
  }
}
