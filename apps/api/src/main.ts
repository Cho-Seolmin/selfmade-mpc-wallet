import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { json } from 'express';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

function getFrontendOrigin(): string {
  return process.env.FRONTEND_URL ?? 'http://localhost:5173';
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // DKLs round messages exchanged with the browser can exceed the default 100kb.
  app.use(json({ limit: '15mb' }));
  app.use(cookieParser());

  app.enableCors({
    origin: getFrontendOrigin(),
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
}
bootstrap();
