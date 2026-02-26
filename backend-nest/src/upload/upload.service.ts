import { Injectable } from '@nestjs/common';
import * as path from 'path';
import * as fs from 'fs';

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');

@Injectable()
export class UploadService {
  getUploadDir(): string {
    return UPLOAD_DIR;
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
}
