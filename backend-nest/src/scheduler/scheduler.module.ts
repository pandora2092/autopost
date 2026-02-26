import { Module } from '@nestjs/common';
import { SchedulerService } from './scheduler.service';
import { PublisherService } from './publisher.service';
import { PostRunnerService } from './post-runner.service';
import { VmModule } from '../vm/vm.module';

@Module({
  imports: [VmModule],
  providers: [SchedulerService, PublisherService, PostRunnerService],
})
export class SchedulerModule {}
