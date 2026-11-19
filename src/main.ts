import 'reflect-metadata';
import { Controller, Get, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getStatus, initSecretsManager, SECRET_NAME, SECRETS_REGION } from './secrets';

@Controller()
class StatusController {
  // Test-only: reports key NAMES, never values.
  @Get('secret-status')
  status() {
    return { secretName: SECRET_NAME, region: SECRETS_REGION, ...getStatus() };
  }
}

@Module({ controllers: [StatusController] })
class AppModule {}

async function bootstrap() {
  await initSecretsManager(); // before NestFactory.create(); never throws
  const app = await NestFactory.create(AppModule);
  await app.listen(3000, '127.0.0.1');
}
bootstrap();
