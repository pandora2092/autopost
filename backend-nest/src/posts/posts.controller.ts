import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { PostsService, CreatePostDto, UpdatePostDto } from './posts.service';

@Controller('api/posts')
export class PostsController {
  constructor(private readonly postsService: PostsService) {}

  @Get()
  findAll(@Query('status') status?: string, @Query('profile_id') profile_id?: string) {
    return this.postsService.findAll(status, profile_id);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.postsService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreatePostDto) {
    return this.postsService.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePostDto) {
    return this.postsService.update(id, dto);
  }

  @Delete()
  clearAll() {
    return this.postsService.clearAll();
  }

  @Delete(':id')
  cancel(@Param('id') id: string) {
    return this.postsService.cancel(id);
  }
}
