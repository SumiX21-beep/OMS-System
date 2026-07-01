import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AllModule } from './all.module';
import { PrismaExceptionFilter } from './common/filters/prisma-exception.filter';

/**
 * Single-process bootstrap: same HTTP surface as main.ts, but the app also runs
 * the BullMQ worker and scheduler (see AllModule). One process, one port — the
 * shape a free PaaS web service (e.g. Render) expects.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AllModule, { rawBody: true });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useGlobalFilters(new PrismaExceptionFilter());

  const config = app.get(ConfigService);

  app.enableCors({
    origin: config.get<string>('CORS_ORIGIN', '*'),
    allowedHeaders: [
      'content-type',
      'authorization',
      'x-api-key',
      'x-tenant-id',
      'idempotency-key',
      'x-request-id',
    ],
  });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('OMS-omni API')
    .setDescription('Omnichannel Inventory & Distributed Order Management')
    .setVersion('1.0')
    .addBearerAuth()
    .addApiKey({ type: 'apiKey', name: 'x-tenant-id', in: 'header' }, 'tenant')
    .build();
  SwaggerModule.setup(
    'docs',
    app,
    SwaggerModule.createDocument(app, swaggerConfig),
    { jsonDocumentUrl: 'docs-json' },
  );

  app.enableShutdownHooks();

  const port = config.get<number>('PORT', 3000);
  await app.listen(port, '0.0.0.0');
  Logger.log(
    `OMS all-in-one listening on :${port} (API + worker + scheduler)`,
    'Bootstrap',
  );
}

void bootstrap();
