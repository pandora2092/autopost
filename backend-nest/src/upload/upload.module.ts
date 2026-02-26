import { Module } from '@nestjs/common';
import { UploadController } from './upload.controller';
import { UploadService } from './upload.service';
import { CleanupService } from './cleanup.service';

@Module({
  controllers: [UploadController],
  providers: [UploadService, CleanupService],
  exports: [UploadService],
})
export class UploadModule {}
