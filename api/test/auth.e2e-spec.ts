import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { createTestApp, resetDatabase } from './helpers/test-app.js';

const nusrat = {
  name: 'Nusrat',
  email: 'Nusrat@TeslaPool.test', // mixed case on purpose
  password: 'tesla1234',
};

describe('Auth (e2e)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('signs up, stays logged in with the cookie, and logs out', async () => {
    const agent = request.agent(app.getHttpServer()); // keeps cookies between requests

    const signup = await agent.post('/auth/signup').send(nusrat);
    expect(signup.status).toBe(201);
    expect(signup.body).toMatchObject({
      name: 'Nusrat',
      email: 'nusrat@teslapool.test',
      role: 'PASSENGER',
    });
    expect(signup.body.passwordHash).toBeUndefined();
    const cookie = signup.headers['set-cookie']?.[0] ?? '';
    expect(cookie).toContain('tesla_session=');
    expect(cookie).toContain('HttpOnly');

    const me = await agent.get('/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.email).toBe('nusrat@teslapool.test');

    const logout = await agent.post('/auth/logout');
    expect(logout.status).toBe(204);

    const meAfterLogout = await agent.get('/auth/me');
    expect(meAfterLogout.status).toBe(401);
  });

  it('rejects a second account with the same email in any letter case', async () => {
    await request(app.getHttpServer()).post('/auth/signup').send(nusrat);

    const again = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ ...nusrat, email: 'nusrat@teslapool.test' });

    expect(again.status).toBe(409);
  });

  it('logs in with the right password and rejects a wrong one', async () => {
    await request(app.getHttpServer()).post('/auth/signup').send(nusrat);

    const good = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'nusrat@teslapool.test', password: 'tesla1234' });
    expect(good.status).toBe(200);

    const wrong = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'nusrat@teslapool.test', password: 'wrong-password' });
    expect(wrong.status).toBe(401);
    expect(wrong.body.message).toBe('Invalid email or password');
  });

  it('rejects requests without a valid session cookie', async () => {
    const noCookie = await request(app.getHttpServer()).get('/auth/me');
    expect(noCookie.status).toBe(401);

    const fakeCookie = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', 'tesla_session=not-a-real-token');
    expect(fakeCookie.status).toBe(401);
  });

  it('rejects invalid input and unknown fields', async () => {
    const shortPassword = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ ...nusrat, password: 'short' });
    expect(shortPassword.status).toBe(400);

    // A client must not be able to make itself a driver.
    const extraField = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ ...nusrat, role: 'DRIVER' });
    expect(extraField.status).toBe(400);
  });
});
