import { Injectable } from '@nestjs/common';
import { execSync } from 'child_process';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class SystemService {
  constructor(private readonly db: DatabaseService) {}

  getQueue() {
    const db = this.db.getDb();
    const pending = db.prepare(`
      SELECT s.id, s.profile_id, s.scheduled_at, s.status, pr.instagram_username, pr.social_network, v.name AS vm_name
      FROM scheduled_post s
      JOIN profile pr ON pr.id = s.profile_id
      JOIN vm v ON v.id = pr.vm_id
      WHERE s.status IN ('pending','assigned','publishing')
      ORDER BY s.scheduled_at ASC
    `).all();
    const byStatus = db.prepare('SELECT status, COUNT(*) AS count FROM scheduled_post GROUP BY status').all();
    const recent = db.prepare(`
      SELECT s.id, s.profile_id, s.published_at, s.status, pr.instagram_username, pr.social_network
      FROM scheduled_post s
      JOIN profile pr ON pr.id = s.profile_id
      WHERE s.status = 'published'
      ORDER BY s.published_at DESC LIMIT 20
    `).all();
    return { pending, byStatus, recent };
  }

  getStats() {
    const db = this.db.getDb();
    const vmCount = db.prepare('SELECT COUNT(*) AS c FROM vm').get() as { c: number };
    const profileCount = db.prepare('SELECT COUNT(*) AS c FROM profile').get() as { c: number };
    const postCounts = db.prepare('SELECT status, COUNT(*) AS c FROM scheduled_post GROUP BY status').all() as { status: string; c: number }[];
    const posts: Record<string, number> = {};
    postCounts.forEach((r) => (posts[r.status] = r.c));
    return { vm: vmCount.c, profile: profileCount.c, posts };
  }

  /** Возвращает свободное и общее место на диске (в байтах) для /. */
  getDiskSpace(): { free: number; total: number } {
    try {
      const out = execSync('df -k -P /', {
        encoding: 'utf8',
        timeout: 5000,
        env: { ...process.env, LANG: 'C', LC_ALL: 'C' },
      });
      const lines = out.trim().split('\n').filter((l) => l.length > 0);
      const dataLine = lines[lines.length - 1];
      if (!dataLine) return { free: 0, total: 0 };
      const parts = dataLine.split(/\s+/);
      if (parts.length < 4) return { free: 0, total: 0 };
      const totalK = parseInt(parts[1], 10);
      const availK = parseInt(parts[3], 10);
      if (!Number.isFinite(totalK) || !Number.isFinite(availK)) return { free: 0, total: 0 };
      return { free: availK * 1024, total: totalK * 1024 };
    } catch {
      return { free: 0, total: 0 };
    }
  }
}
