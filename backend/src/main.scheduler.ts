import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SchedulerModule } from './scheduler.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(SchedulerModule);
  app.enableShutdownHooks();
  Logger.log('OMS scheduler started', 'Bootstrap');
}

void bootstrap();
