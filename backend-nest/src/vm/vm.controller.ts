import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { VmService, CreateVmDto, UpdateVmDto } from './vm.service';

@Controller('api/vm')
export class VmController {
  constructor(private readonly vmService: VmService) {}

  @Get()
  findAll() {
    return this.vmService.findAll();
  }

  @Get(':id/ip')
  getVmIp(@Param('id') id: string, @Query('save') save?: string) {
    return this.vmService.getVmIp(id, save === '1' || save === 'true');
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.vmService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateVmDto) {
    return this.vmService.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateVmDto) {
    return this.vmService.update(id, dto);
  }

  @Post(':id/start')
  start(@Param('id') id: string) {
    return this.vmService.start(id);
  }

  @Post(':id/stop')
  stop(@Param('id') id: string) {
    return this.vmService.stop(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    this.vmService.remove(id);
  }

  @Post(':id/set-android-id')
  setAndroidId(@Param('id') id: string, @Body() body: { android_id?: string }) {
    return this.vmService.setAndroidId(id, body.android_id);
  }

  @Post(':id/install-instagram')
  installInstagram(@Param('id') id: string, @Body() body: { apk_path?: string }) {
    return this.vmService.installInstagram(id, body.apk_path);
  }

  @Post(':id/apply-proxy')
  applyProxy(@Param('id') id: string, @Body() body?: { pushConfig?: boolean }) {
    this.vmService.applyProxy(id, body?.pushConfig === true);
    return { ok: true };
  }
}
