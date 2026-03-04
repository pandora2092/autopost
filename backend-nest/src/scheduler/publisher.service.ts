import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { PostRunnerService } from './post-runner.service';
import { VmManagerService } from '../vm/vm-manager.service';

const ACTION_DELAY_MIN_MS = 2000;
const ACTION_DELAY_MAX_MS = 10000;
const VM_RESTART_DELAY_MS = parseInt(process.env.VM_RESTART_DELAY_MS || '8000', 10);

@Injectable()
export class PublisherService {
  private queue: { id: string; profile_id: string; media_path: string; caption: string | null; scheduled_at: string }[] = [];
  private running = false;

  constructor(
    private readonly db: DatabaseService,
    private readonly postRunner: PostRunnerService,
    private readonly vmManager: VmManagerService,
  ) {}

  enqueue(post: { id: string; profile_id: string; media_path: string; caption: string | null; scheduled_at: string }): Promise<void> {
    this.queue.push(post);
    return this.drain();
  }

  private randomDelay() {
    const ms = ACTION_DELAY_MIN_MS + Math.random() * (ACTION_DELAY_MAX_MS - ACTION_DELAY_MIN_MS);
    return new Promise((r) => setTimeout(r, ms));
  }

  private isVmHungError(msg: string): boolean {
    const s = msg.toLowerCase();
    return (
      s.includes('timeout') ||
      s.includes('ping') ||
      s.includes('не отвечает') ||
      s.includes('adbexec') ||
      s.includes('operation was aborted') ||
      s.includes('could not find a connected android device')
    );
  }

  private async getVmForPost(postId: string): Promise<{ vm_id: string; libvirt_domain: string } | null> {
    const row = this.db.getDb().prepare(
      `SELECT v.id AS vm_id, v.libvirt_domain FROM scheduled_post s
       JOIN profile pr ON pr.id = s.profile_id JOIN vm v ON v.id = pr.vm_id WHERE s.id = ?`,
    ).get(postId) as { vm_id: string; libvirt_domain: string } | undefined;
    return row ?? null;
  }

  private async restartVmAndUpdateAdb(vmId: string, libvirtDomain: string): Promise<boolean> {
    try {
      this.vmManager.forceStopVm(libvirtDomain);
      await new Promise((r) => setTimeout(r, VM_RESTART_DELAY_MS));
      const { adb_address } = await this.vmManager.startVmAndWaitReady(libvirtDomain);
      this.db.getDb().prepare("UPDATE vm SET status = ?, adb_address = ?, updated_at = datetime('now') WHERE id = ?").run('running', adb_address, vmId);
      return true;
    } catch (e) {
      console.error('Publisher: VM restart failed', libvirtDomain, (e as Error)?.message);
      return false;
    }
  }

  private async processOne(post: { id: string }) {
    const db = this.db.getDb();
    db.prepare("UPDATE scheduled_post SET status = ?, updated_at = datetime('now') WHERE id = ?").run('publishing', post.id);
    await this.randomDelay();
    try {
      await this.postRunner.publish(post);
      db.prepare(
        "UPDATE scheduled_post SET status = ?, published_at = datetime('now'), updated_at = datetime('now'), error_message = NULL WHERE id = ?",
      ).run('published', post.id);
      await this.stopVmAfterPublish(post.id);
    } catch (err) {
      const msg = (err as Error)?.message || String(err);
      if (this.isVmHungError(msg)) {
        const vm = await this.getVmForPost(post.id);
        if (vm && (await this.restartVmAndUpdateAdb(vm.vm_id, vm.libvirt_domain))) {
          console.warn('Publisher: VM restarted, retrying post', post.id);
          try {
            await this.postRunner.publish(post);
            db.prepare(
              "UPDATE scheduled_post SET status = ?, published_at = datetime('now'), updated_at = datetime('now'), error_message = NULL WHERE id = ?",
            ).run('published', post.id);
            await this.stopVmAfterPublish(post.id);
            await this.randomDelay();
            return;
          } catch (retryErr) {
            // fall through to mark failed
          }
        }
      }
      console.error('Publisher: post failed', post.id, msg);
      db.prepare(
        "UPDATE scheduled_post SET status = ?, error_message = ?, updated_at = datetime('now') WHERE id = ?",
      ).run('failed', msg, post.id);
      await this.stopVmAfterPublish(post.id);
    }
    await this.randomDelay();
  }

  /** После публикации (успешной или с ошибкой) принудительно выключает VM (virsh destroy). */
  private async stopVmAfterPublish(postId: string): Promise<void> {
    const db = this.db.getDb();
    const row = db.prepare(
      `SELECT v.id AS vm_id, v.libvirt_domain FROM scheduled_post s
       JOIN profile pr ON pr.id = s.profile_id
       JOIN vm v ON v.id = pr.vm_id WHERE s.id = ?`,
    ).get(postId) as { vm_id: string; libvirt_domain: string } | undefined;
    if (!row) return;
    try {
      this.vmManager.forceStopVm(row.libvirt_domain);
      db.prepare("UPDATE vm SET status = ?, updated_at = datetime('now') WHERE id = ?").run('stopped', row.vm_id);
    } catch (err) {
      console.error('Publisher: failed to stop VM after publish', row.vm_id, (err as Error)?.message);
    }
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
