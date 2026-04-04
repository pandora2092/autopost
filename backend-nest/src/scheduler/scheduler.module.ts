import { Module } from '@nestjs/common';
import { SchedulerService } from './scheduler.service';
import { PublisherService } from './publisher.service';
import { PostRunnerService } from './post-runner.service';
import { AppiumPublishService } from './appium-publish.service';
import { PublishCancellationRegistry } from './publish-cancellation.registry';
import { VmModule } from '../vm/vm.module';

@Module({
  imports: [VmModule],
  providers: [
    PublishCancellationRegistry,
    SchedulerService,
    PublisherService,
    PostRunnerService,
    AppiumPublishService,
  ],
  exports: [PublishCancellationRegistry],
})
export class SchedulerModule {}
