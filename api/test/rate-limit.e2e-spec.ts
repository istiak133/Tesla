import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import {
  createTestApp,
  resetDatabase,
  seedStoryCast,
} from './helpers/test-app.js';

// The login and sign-up limits (D-013). Off in the other tests, which log in many times in a
// row; this file turns them on. Each test gets a fresh app, so the counters start at zero.
describe('Rate limiting (e2e)', () => {
  let app: NestExpressApplication;

  beforeAll(() => {
    process.env.RATE_LIMIT_IN_TESTS = 'true';
  });

  beforeEach(async () => {
    app = await createTestApp();
    await resetDatabase(app);
    await seedStoryCast(app);
  });

  afterEach(async () => {
    await app.close();
  });

  afterAll(() => {
    delete process.env.RATE_LIMIT_IN_TESTS;
  });

  const wrongLogin = (email: string, forwardedFor?: string) => {
    const call = request(app.getHttpServer()).post('/auth/login');
    if (forwardedFor !== undefined) {
      call.set('X-Forwarded-For', forwardedFor);
    }
    return call.send({
      role: 'PASSENGER',
      email,
      password: 'not-the-password',
    });
  };

  it('allows 5 login attempts a minute from one client, then answers 429', async () => {
    for (let i = 0; i < 5; i++) {
      expect((await wrongLogin('nusrat@teslapool.test')).status).toBe(401);
    }
    expect((await wrongLogin('nusrat@teslapool.test')).status).toBe(429);
  });

  it('a new faked address on every attempt does not get around the per-account limit', async () => {
    const answers: number[] = [];
    for (let i = 1; i <= 11; i++) {
      answers.push(
        (await wrongLogin('nusrat@teslapool.test', `198.51.100.${i}`)).status,
      );
    }
    // Each attempt claims a different client, so the per-address limit never fills up;
    // the account limit (10 per 10 minutes) stops the 11th.
    expect(answers.slice(0, 10)).toEqual(Array(10).fill(401));
    expect(answers[10]).toBe(429);

    // Another account is not blocked by Nusrat's.
    expect(
      (await wrongLogin('shirin@teslapool.test', '198.51.100.99')).status,
    ).toBe(401);
  });
});
