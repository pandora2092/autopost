import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  if (process.env.STREAM_WEB_RELATIVE?.trim()) {
    const hops = parseInt(process.env.TRUST_PROXY_HOPS || '1', 10);
    app.set('trust proxy', Number.isFinite(hops) && hops > 0 ? hops : 1);
  }
  app.enableCors();
  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`Server running at http://localhost:${port}`);
}

bootstrap();
