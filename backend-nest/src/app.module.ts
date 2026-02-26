import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { ProxyModule } from './proxy/proxy.module';
import { VmModule } from './vm/vm.module';
import { ProfilesModule } from './profiles/profiles.module';
import { PostsModule } from './posts/posts.module';
import { SystemModule } from './system/system.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { UploadModule } from './upload/upload.module';
import { AppController } from './app.controller';

@Module({
  imports: [
    DatabaseModule,
    UploadModule,
    ProxyModule,
    VmModule,
    ProfilesModule,
    PostsModule,
    SystemModule,
    SchedulerModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
