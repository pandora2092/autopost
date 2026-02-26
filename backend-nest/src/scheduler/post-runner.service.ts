import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { VmManagerService } from '../vm/vm-manager.service';

@Injectable()
export class PostRunnerService {
  constructor(
    private readonly db: DatabaseService,
    private readonly vmManager: VmManagerService,
  ) {}

  async publish(post: { id: string }): Promise<{ ok: boolean }> {
    const row = this.db.getDb()
      .prepare(
        `SELECT s.id, s.profile_id, s.media_path, s.caption, pr.vm_id, v.adb_address, v.libvirt_domain
         FROM scheduled_post s
         JOIN profile pr ON pr.id = s.profile_id
         JOIN vm v ON v.id = pr.vm_id
         WHERE s.id = ?`,
      )
      .get(post.id) as { adb_address: string | null; libvirt_domain: string } | undefined;
    if (!row) throw new Error('Post or VM not found');
    let adbAddress = row.adb_address;
    if (!adbAddress) {
      const ip = this.vmManager.getVmIp(row.libvirt_domain);
      if (ip) adbAddress = ip + ':5555';
    }
    if (!adbAddress) throw new Error('VM adb_address не задан. Запустите VM и укажите ADB (IP:5555).');
    const useAppium = process.env.USE_APPIUM === '1' || process.env.USE_APPIUM === 'true';
    if (useAppium) {
      throw new Error('Appium integration: add appiumPublish service when needed');
    }
    await new Promise((r) => setTimeout(r, 2000 + Math.random() * 3000));
    return { ok: true };
  }
}
