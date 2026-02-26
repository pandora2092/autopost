import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
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
  getStreamUrl(@Param('id') id: string) {
    return this.profilesService.getStreamUrl(id);
  }
}
