import { Injectable, OnModuleInit } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { PublisherService } from './publisher.service';
import { VmManagerService } from '../vm/vm-manager.service';
import * as cron from 'node-cron';

const MAX_POSTS_PER_DAY = parseInt(process.env.MAX_POSTS_PER_DAY || '10', 10);
const MIN_INTERVAL_HOURS = parseFloat(process.env.MIN_INTERVAL_HOURS || '0');
const CRON_SCHEDULE = process.env.SCHEDULER_CRON || '* * * * *';

interface PostRow {
  id: string;
  profile_id: string;
  media_path: string;
  caption: string | null;
  scheduled_at: string;
  vm_id: string;
  libvirt_domain: string;
  vm_status: string;
}

@Injectable()
export class SchedulerService implements OnModuleInit {
  constructor(
    private readonly db: DatabaseService,
    private readonly publisher: PublisherService,
    private readonly vmManager: VmManagerService,
  ) {}

  onModuleInit() {
    cron.schedule(CRON_SCHEDULE, () => {
      try {
        this.runTick();
      } catch (err) {
        console.error('Scheduler tick error:', err);
      }
    });
    console.log('Scheduler started (cron: %s)', CRON_SCHEDULE);
  }

  private getPublishedTodayCount(profileId: string): number {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const r = this.db.getDb()
      .prepare(
        'SELECT COUNT(*) AS c FROM scheduled_post WHERE profile_id = ? AND status = ? AND published_at >= ?',
      )
      .get(profileId, 'published', start.toISOString()) as { c: number };
    return r.c;
  }

  private getLastPublishedAt(profileId: string): string | null {
    const r = this.db.getDb()
      .prepare(
        'SELECT published_at FROM scheduled_post WHERE profile_id = ? AND status = ? AND published_at IS NOT NULL ORDER BY published_at DESC LIMIT 1',
      )
      .get(profileId, 'published') as { published_at: string } | undefined;
    return r?.published_at ?? null;
  }

  private canPublishNow(profileId: string): boolean {
    if (this.getPublishedTodayCount(profileId) >= MAX_POSTS_PER_DAY) return false;
    const lastAt = this.getLastPublishedAt(profileId);
    if (!lastAt) return true;
    const diffHours = (Date.now() - new Date(lastAt).getTime()) / (1000 * 60 * 60);
    return diffHours >= MIN_INTERVAL_HOURS;
  }

  /**
   * Для каждой VM из списка постов: если VM не running — запускает и ждёт готовности, применяет прокси, обновляет БД.
   * При таймауте — принудительно останавливает, пауза, повторный запуск. Возвращает true, если VM готова.
   */
  private async ensureVmRunning(vmId: string, libvirtDomain: string): Promise<boolean> {
    const db = this.db.getDb();
    const row = db.prepare('SELECT id, status, mac, proxy_id FROM vm WHERE id = ?').get(vmId) as {
      id: string;
      status: string;
      mac: string | null;
      proxy_id: string | null;
    } | undefined;
    if (!row) return false;
    if (row.status === 'running') return true;
    const restartDelayMs = parseInt(process.env.VM_RESTART_DELAY_MS || '8000', 10);
    const tryStart = async (): Promise<{ adb_address: string } | null> => {
      try {
        return await this.vmManager.startVmAndWaitReady(libvirtDomain, row.mac);
      } catch {
        return null;
      }
    };
    let result = await tryStart();
    if (!result) {
      console.warn('Scheduler: VM', libvirtDomain, 'timeout, forcing restart...');
      this.vmManager.forceStopVm(libvirtDomain);
      await new Promise((r) => setTimeout(r, restartDelayMs));
      result = await tryStart();
    }
    if (result) {
      db.prepare("UPDATE vm SET status = ?, adb_address = ?, updated_at = datetime('now') WHERE id = ?").run('running', result.adb_address, vmId);
      if (row.proxy_id) {
        const proxy = db.prepare('SELECT type, host, port, login, password FROM proxy WHERE id = ?').get(row.proxy_id) as {
          type: string;
          host: string;
          port: number;
          login: string | null;
          password: string | null;
        } | undefined;
        if (proxy) {
          try {
            this.vmManager.applyProxy(result.adb_address, proxy, { pushConfig: true });
          } catch (e) {
            console.warn('Scheduler: applyProxy failed for VM', vmId, (e as Error)?.message);
          }
        }
      }
      return true;
    }
    console.error('Scheduler: failed to start VM', vmId, 'after restart');
    return false;
  }

  /**
   * Выбирает посты для публикации (scheduled_at <= now, pending). Для постов с выключенной VM
   * запускает VM и ждёт готовности; посты с VM, которую не удалось запустить, остаются pending.
   */
  private async pickPostsToPublish(): Promise<PostRow[]> {
    const now = new Date().toISOString();
    const rows = this.db.getDb()
      .prepare(
        `SELECT s.id, s.profile_id, s.media_path, s.caption, s.scheduled_at,
                v.id AS vm_id, v.libvirt_domain, v.status AS vm_status
         FROM scheduled_post s
         JOIN profile pr ON pr.id = s.profile_id
         JOIN vm v ON v.id = pr.vm_id
         WHERE s.status = 'pending' AND s.scheduled_at <= ?
         ORDER BY s.scheduled_at ASC`,
      )
      .all(now) as PostRow[];
    const byProfile = rows.filter((row) => this.canPublishNow(row.profile_id));
    const byVm = new Map<string, PostRow[]>();
    for (const row of byProfile) {
      const list = byVm.get(row.vm_id) ?? [];
      list.push(row);
      byVm.set(row.vm_id, list);
    }
    const result: PostRow[] = [];
    for (const [, postList] of byVm) {
      const first = postList[0];
      const ok = first.vm_status === 'running' || (await this.ensureVmRunning(first.vm_id, first.libvirt_domain));
      if (ok) result.push(...postList);
    }
    return result;
  }

  private assignPost(postId: string) {
    this.db.getDb()
      .prepare(
        "UPDATE scheduled_post SET status = ?, assigned_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
      )
      .run('assigned', postId);
  }

  async runTick() {
    const toPublish = await this.pickPostsToPublish();
    for (const post of toPublish) {
      this.assignPost(post.id);
      this.publisher.enqueue(post).catch((err: unknown) => {
        this.db.getDb()
          .prepare(
            "UPDATE scheduled_post SET status = ?, error_message = ?, updated_at = datetime('now') WHERE id = ?",
          )
          .run('failed', (err as Error)?.message || String(err), post.id);
      });
    }
  }
}
