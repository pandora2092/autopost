import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { VmManagerService } from '../vm/vm-manager.service';
import { AppiumPublishService } from './appium-publish.service';

@Injectable()
export class PostRunnerService {
  constructor(
    private readonly db: DatabaseService,
    private readonly vmManager: VmManagerService,
    private readonly appiumPublish: AppiumPublishService,
  ) {}

  async publish(post: { id: string }): Promise<{ ok: boolean }> {
    const row = this.db.getDb()
      .prepare(
        `SELECT s.id, s.profile_id, s.media_path, s.caption, pr.vm_id, v.adb_address, v.libvirt_domain, v.status AS vm_status,
                v.proxy_id, p.type AS proxy_type, p.host AS proxy_host, p.port AS proxy_port, p.login AS proxy_login, p.password AS proxy_password
         FROM scheduled_post s
         JOIN profile pr ON pr.id = s.profile_id
         JOIN vm v ON v.id = pr.vm_id
         LEFT JOIN proxy p ON p.id = v.proxy_id
         WHERE s.id = ?`,
      )
      .get(post.id) as {
        adb_address: string | null;
        libvirt_domain: string;
        vm_status: string;
        media_path: string;
        caption: string | null;
        proxy_id: string | null;
        proxy_type: string | null;
        proxy_host: string | null;
        proxy_port: number | null;
        proxy_login: string | null;
        proxy_password: string | null;
      } | undefined;
    if (!row) throw new Error('Post or VM not found');
    if (row.vm_status !== 'running') {
      throw new Error('VM должна быть включена для публикации.');
    }
    let adbAddress = row.adb_address;
    if (!adbAddress) {
      const ip = this.vmManager.getVmIp(row.libvirt_domain);
      if (ip) adbAddress = ip + ':5555';
    }
    if (!adbAddress) throw new Error('VM adb_address не задан. Запустите VM и укажите ADB (IP:5555).');
    if (row.proxy_id && row.proxy_type && row.proxy_host != null && row.proxy_port != null) {
      this.vmManager.applyProxy(adbAddress, {
        type: row.proxy_type,
        host: row.proxy_host,
        port: row.proxy_port,
        login: row.proxy_login ?? undefined,
        password: row.proxy_password ?? undefined,
      });
    }
    const useAppium = process.env.USE_APPIUM === '1' || process.env.USE_APPIUM === 'true';
    if (!useAppium) {
      throw new Error(
        'Для публикации необходим Appium. Задайте USE_APPIUM=1 и запустите Appium server (подключённый к устройству по ADB).',
      );
    }
    await this.appiumPublish.publishWithAppium(
      { id: post.id, media_path: row.media_path, caption: row.caption },
      adbAddress,
    );
    return { ok: true };
  }
}
