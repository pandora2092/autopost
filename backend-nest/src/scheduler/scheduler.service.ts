import { Injectable, OnModuleInit } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { PublisherService } from './publisher.service';
import * as cron from 'node-cron';

const MAX_POSTS_PER_DAY = parseInt(process.env.MAX_POSTS_PER_DAY || '3', 10);
const MIN_INTERVAL_HOURS = parseFloat(process.env.MIN_INTERVAL_HOURS || '4');
const CRON_SCHEDULE = process.env.SCHEDULER_CRON || '* * * * *';

@Injectable()
export class SchedulerService implements OnModuleInit {
  constructor(
    private readonly db: DatabaseService,
    private readonly publisher: PublisherService,
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

  private pickPostsToPublish() {
    const now = new Date().toISOString();
    const rows = this.db.getDb()
      .prepare(
        `SELECT id, profile_id, media_path, caption, scheduled_at
         FROM scheduled_post WHERE status = 'pending' AND scheduled_at <= ? ORDER BY scheduled_at ASC`,
      )
      .all(now) as { id: string; profile_id: string; media_path: string; caption: string | null; scheduled_at: string }[];
    return rows.filter((row) => this.canPublishNow(row.profile_id));
  }

  private assignPost(postId: string) {
    this.db.getDb()
      .prepare(
        'UPDATE scheduled_post SET status = ?, assigned_at = datetime("now"), updated_at = datetime("now") WHERE id = ?',
      )
      .run('assigned', postId);
  }

  runTick() {
    const toPublish = this.pickPostsToPublish();
    for (const post of toPublish) {
      this.assignPost(post.id);
      this.publisher.enqueue(post).catch((err: unknown) => {
        this.db.getDb()
          .prepare(
            'UPDATE scheduled_post SET status = ?, error_message = ?, updated_at = datetime("now") WHERE id = ?',
          )
          .run('failed', (err as Error)?.message || String(err), post.id);
      });
    }
  }
}
