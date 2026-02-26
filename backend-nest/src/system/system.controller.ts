import { Controller, Get } from '@nestjs/common';
import { SystemService } from './system.service';

@Controller('api/system')
export class SystemController {
  constructor(private readonly systemService: SystemService) {}

  @Get('queue')
  getQueue() {
    return this.systemService.getQueue();
  }

  @Get('stats')
  getStats() {
    return this.systemService.getStats();
  }
}
