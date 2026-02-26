import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { ProxyService, CreateProxyDto, UpdateProxyDto } from './proxy.service';

@Controller('api/proxy')
export class ProxyController {
  constructor(private readonly proxyService: ProxyService) {}

  @Get()
  findAll() {
    return this.proxyService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.proxyService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateProxyDto) {
    return this.proxyService.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateProxyDto) {
    return this.proxyService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    this.proxyService.remove(id);
  }
}
