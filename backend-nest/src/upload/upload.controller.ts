import {
  Controller,
  Post,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { UploadService } from './upload.service';
import * as path from 'path';
import * as fs from 'fs';

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');
const MAX_SIZE = 500 * 1024 * 1024; // 500 MB

@Controller('api')
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req: unknown, _file: Express.Multer.File, cb: (e: Error | null, p: string) => void) => {
          if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
          cb(null, UPLOAD_DIR);
        },
        filename: (_req: unknown, file: Express.Multer.File, cb: (e: Error | null, n: string) => void) => {
          const ext = path.extname(file.originalname).toLowerCase() || '.mp4';
          cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
        },
      }),
      limits: { fileSize: MAX_SIZE },
      fileFilter: (_req: unknown, file: Express.Multer.File, cb: (e: Error | null, accept: boolean) => void) => {
        const ok = ['video/mp4', 'video/quicktime'].includes(file.mimetype) || file.originalname?.toLowerCase().endsWith('.mp4');
        if (ok) cb(null, true);
        else cb(new BadRequestException('Разрешён только MP4 (рилс)'), false);
      },
    }),
  )
  async upload(@UploadedFile() file: Express.Multer.File | undefined) {
    if (!file) throw new BadRequestException('Выберите файл MP4');
    await this.uploadService.ensureFaststart(file.path);
    const relativePath = this.uploadService.toRelativePath(file.path);
    return { path: relativePath };
  }
}
