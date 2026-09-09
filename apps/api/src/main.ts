import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { json } from 'express';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import {
  assertApiEnv,
  frontendOrigin,
  shouldTrustOneProxyHop,
} from './config/api-env';

async function bootstrap() {
  assertApiEnv();

  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  if (shouldTrustOneProxyHop()) {
    // One hop (Railway edge). Do not use `true` — that trusts leftmost X-Forwarded-For.
    app.set('trust proxy', 1);
  }

  app.use(helmet());
  // DKLs round messages exchanged with the browser can exceed the default 100kb.
  app.use(json({ limit: '15mb' }));
  app.use(cookieParser());

  app.enableCors({
    origin: frontendOrigin(),
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
