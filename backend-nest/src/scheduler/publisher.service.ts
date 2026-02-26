import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { PostRunnerService } from './post-runner.service';

const ACTION_DELAY_MIN_MS = 2000;
const ACTION_DELAY_MAX_MS = 10000;

@Injectable()
export class PublisherService {
  private queue: { id: string; profile_id: string; media_path: string; caption: string | null; scheduled_at: string }[] = [];
  private running = false;

  constructor(
    private readonly db: DatabaseService,
    private readonly postRunner: PostRunnerService,
  ) {}

  enqueue(post: { id: string; profile_id: string; media_path: string; caption: string | null; scheduled_at: string }): Promise<void> {
    this.queue.push(post);
    return this.drain();
  }

  private randomDelay() {
    const ms = ACTION_DELAY_MIN_MS + Math.random() * (ACTION_DELAY_MAX_MS - ACTION_DELAY_MIN_MS);
    return new Promise((r) => setTimeout(r, ms));
  }

  private async processOne(post: { id: string }) {
    const db = this.db.getDb();
    db.prepare('UPDATE scheduled_post SET status = ?, updated_at = datetime("now") WHERE id = ?').run('publishing', post.id);
    await this.randomDelay();
    try {
      await this.postRunner.publish(post);
      db.prepare(
        'UPDATE scheduled_post SET status = ?, published_at = datetime("now"), updated_at = datetime("now"), error_message = NULL WHERE id = ?',
      ).run('published', post.id);
    } catch (err) {
      db.prepare(
        'UPDATE scheduled_post SET status = ?, error_message = ?, updated_at = datetime("now") WHERE id = ?',
      ).run('failed', (err as Error)?.message || String(err), post.id);
    }
    await this.randomDelay();
  }

  private async drain(): Promise<void> {
    if (this.running || this.queue.length === 0) return;
    this.running = true;
    while (this.queue.length > 0) {
      const post = this.queue.shift()!;
      await this.processOne(post);
    }
    this.running = false;
  }
}
