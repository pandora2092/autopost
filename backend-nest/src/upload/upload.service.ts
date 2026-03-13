import { Injectable } from '@nestjs/common';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');

@Injectable()
export class UploadService {
  getUploadDir(): string {
    return UPLOAD_DIR;
  }

  /**
   * Перезаписывает видео (mp4/mov): +faststart; по возможности аудио в AAC. Пауза после сохранения, при ошибке — retry и запасной вариант без -c:a aac.
   */
  async ensureFaststart(fullPath: string): Promise<void> {
    const ext = path.extname(fullPath).toLowerCase();
    if (ext !== '.mp4' && ext !== '.mov') return;
    if (!fs.existsSync(fullPath)) return;
    await new Promise((r) => setTimeout(r, 2000));
    const tmpPath = path.join(os.tmpdir(), `instapost-${Date.now()}${ext}`);
    const execOpts = { encoding: 'utf8' as const, timeout: 120000 };

    const runCmd = (cmd: string): void => {
      execSync(cmd, execOpts);
      if (fs.existsSync(tmpPath)) {
        fs.renameSync(tmpPath, fullPath);
      }
    };

    const fullCmd = `ffmpeg -i "${fullPath}" -map 0:v -map 0:a? -c:v copy -c:a aac -movflags +faststart -y "${tmpPath}"`;
    const simpleCmd = `ffmpeg -i "${fullPath}" -c copy -movflags +faststart -y "${tmpPath}"`;

    const lastErr = (e: unknown): string =>
      (e as { stderr?: string })?.stderr ?? (e as Error)?.message ?? String(e);

    for (const cmd of [fullCmd, fullCmd]) {
      try {
        runCmd(cmd);
        return;
      } catch (err: unknown) {
        if (fs.existsSync(tmpPath)) try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
        console.error('[Upload] ffmpeg failed:', fullPath, lastErr(err));
        await new Promise((r) => setTimeout(r, 3000));
      }
    }

    try {
      runCmd(simpleCmd);
      return;
    } catch (err: unknown) {
      if (fs.existsSync(tmpPath)) try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
      const msg = lastErr(err);
      console.error('[Upload] ffmpeg fallback failed:', fullPath, msg);
      throw new Error(`Не удалось обработать видео (ffmpeg). ${msg}`);
    }
  }

  /** Возвращает относительный путь uploads/xxx.mp4 для сохранения в БД. */
  toRelativePath(fullPath: string): string {
    const dir = path.resolve(UPLOAD_DIR);
    const resolved = path.resolve(fullPath);
    if (!resolved.startsWith(dir)) return fullPath;
    const rel = path.relative(process.cwd(), resolved);
    return rel.split(path.sep).join('/');
  }

  getFullPath(relativePath: string): string {
    if (path.isAbsolute(relativePath)) return relativePath;
    return path.join(process.cwd(), relativePath);
  }

  /** Удаляет все .mp4 файлы в папке uploads. Возвращает число удалённых файлов. */
  clearAllMp4(): number {
    const dir = this.getUploadDir();
    if (!fs.existsSync(dir)) return 0;
    let deleted = 0;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      if (!ent.isFile() || !ent.name.toLowerCase().endsWith('.mp4')) continue;
      const fullPath = path.join(dir, ent.name);
      try {
        fs.unlinkSync(fullPath);
        deleted++;
      } catch (_) {}
    }
    return deleted;
  }
}
