import 'dotenv/config';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

// Boots the real AppModule (DB + all providers), so this suite needs a
// reachable DATABASE_URL / JWT_SECRET, same as `npm run start:dev`.
// It is intentionally excluded from CI (see .github/workflows/ci.yml) and is
// meant to be run locally via `npm run test:e2e`.
describe('App (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /wallets without a token is rejected', async () => {
    await request(app.getHttpServer()).get('/wallets').expect(401);
  });

  it('GET /wallets/summary without a token is rejected', async () => {
    await request(app.getHttpServer()).get('/wallets/summary').expect(401);
  });

  const frontendOrigin = (
    process.env.FRONTEND_URL ?? 'http://localhost:5173'
  ).replace(/\/$/, '');

  it('POST /auth/login rejects a malformed email via the global ValidationPipe', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .set('Origin', frontendOrigin)
      .send({ email: 'not-an-email', password: 'x' })
      .expect(400);
  });

  it('POST /auth/login rejects unknown credentials', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .set('Origin', frontendOrigin)
      .send({ email: 'no-such-user@example.com', password: 'wrongpassword' })
      .expect(401);
  });

  it('POST /auth/login rejects a mismatched Origin', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .set('Origin', 'https://evil.example')
      .send({ email: 'no-such-user@example.com', password: 'wrongpassword' })
      .expect(403);
  });
});
