import { Injectable, OnModuleInit } from '@nestjs/common';
import * as cron from 'node-cron';
import * as path from 'path';
import * as fs from 'fs';
import { DatabaseService } from '../database/database.service';
import { UploadService } from './upload.service';

const RETENTION_DAYS = parseInt(process.env.UPLOAD_RETENTION_DAYS || '7', 10);
const CRON_CLEANUP = process.env.CLEANUP_CRON || '0 3 * * *'; // 03:00 каждый день

@Injectable()
export class CleanupService implements OnModuleInit {
  constructor(
    private readonly db: DatabaseService,
    private readonly uploadService: UploadService,
  ) {}

  onModuleInit() {
    cron.schedule(CRON_CLEANUP, () => {
      try {
        this.runCleanup();
      } catch (err) {
        console.error('Upload cleanup error:', err);
      }
    });
    console.log('Upload cleanup scheduled (cron: %s, retention: %d days)', CRON_CLEANUP, RETENTION_DAYS);
  }

  runCleanup(): number {
    const dir = this.uploadService.getUploadDir();
    if (!fs.existsSync(dir)) return 0;
    const inUse = this.getPathsInUse();
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    let deleted = 0;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      if (!ent.isFile()) continue;
      const fullPath = path.join(dir, ent.name);
      const rel = this.uploadService.toRelativePath(fullPath);
      const normRel = rel.split(path.sep).join('/');
      if (inUse.has(normRel)) continue;
      const stat = fs.statSync(fullPath);
      if (stat.mtimeMs >= cutoff) continue;
      try {
        fs.unlinkSync(fullPath);
        deleted++;
      } catch (_) {}
    }
    if (deleted > 0) console.log('Cleanup: removed %d old file(s) from uploads/', deleted);
    return deleted;
  }

  private getPathsInUse(): Set<string> {
    const rows = this.db.getDb()
      .prepare(
        `SELECT media_path FROM scheduled_post WHERE status IN ('pending','assigned','publishing') AND media_path IS NOT NULL`,
      )
      .all() as { media_path: string }[];
    const set = new Set<string>();
    for (const r of rows) {
      const n = (r.media_path || '').split(path.sep).join('/').trim();
      if (n) set.add(n);
    }
    return set;
  }
}
