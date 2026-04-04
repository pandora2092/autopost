import { Module } from '@nestjs/common';
import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';
import { UploadModule } from '../upload/upload.module';
import { VmModule } from '../vm/vm.module';
import { SchedulerModule } from '../scheduler/scheduler.module';

@Module({
  imports: [UploadModule, VmModule, SchedulerModule],
  controllers: [PostsController],
  providers: [PostsService],
})
export class PostsModule {}
