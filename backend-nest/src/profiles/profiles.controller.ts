import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ProfilesService, CreateProfileDto, UpdateProfileDto } from './profiles.service';

@Controller('api/profiles')
export class ProfilesController {
  constructor(private readonly profilesService: ProfilesService) {}

  @Get()
  findAll() {
    return this.profilesService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.profilesService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateProfileDto) {
    return this.profilesService.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateProfileDto) {
    return this.profilesService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    this.profilesService.remove(id);
  }

  @Get(':id/stream-url')
  getStreamUrl(@Param('id') id: string, @Req() req: Request) {
    return this.profilesService.getStreamUrl(id, req);
  }

  @Post(':id/clear-media')
  clearMedia(@Param('id') id: string) {
    return this.profilesService.clearMedia(id);
  }
}
