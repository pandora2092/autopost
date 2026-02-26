import { Module } from '@nestjs/common';
import { VmController } from './vm.controller';
import { VmService } from './vm.service';
import { VmManagerService } from './vm-manager.service';

@Module({
  controllers: [VmController],
  providers: [VmService, VmManagerService],
  exports: [VmService, VmManagerService],
})
export class VmModule {}
