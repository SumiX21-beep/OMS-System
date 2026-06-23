import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { PrismaExceptionFilter } from './common/filters/prisma-exception.filter';

async function bootstrap(): Promise<void> {
  // rawBody:true preserves the unparsed body on req.rawBody for webhook HMAC.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useGlobalFilters(new PrismaExceptionFilter());

  const config = app.get(ConfigService);

  // Allow the operations console (browser SPA) to call the API.
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

  // OpenAPI docs + spec (the frontend generates its typed client from /docs-json).
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

  const port = config.get<number>('PORT', 3000);
  await app.listen(port);
  Logger.log(`OMS API listening on :${port} (docs at /docs)`, 'Bootstrap');
}

void bootstrap();
