import type { AddressInfo } from 'node:net';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma.service.js';
import { DEMO_PASSWORD } from '../src/seed/seed-data.js';
import {
  createTestApp,
  resetDatabase,
  seedStoryCast,
} from './helpers/test-app.js';

// SIGTERM on a redeploy runs app.close(). Open live streams must end first (their heartbeat
// would keep the HTTP server open until the platform kills the process), and the database
// pool must close last, after the HTTP server, so requests still in flight can finish.
describe('Shutdown (e2e)', () => {
  it('ends open live streams and closes promptly, with the database pool closed last', async () => {
    const app: NestExpressApplication = await createTestApp();
    await resetDatabase(app);
    await seedStoryCast(app);
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        role: 'DRIVER',
        email: 'jashim@teslapool.test',
        password: DEMO_PASSWORD,
      })
      .expect(200);
    const cookie = (
      login.headers['set-cookie'] as unknown as string[]
    )[0].split(';')[0];
    const { port } = app.getHttpServer().address() as AddressInfo;
    const stream = await fetch(`http://127.0.0.1:${port}/events/stream`, {
      headers: { cookie },
    });
    expect(stream.status).toBe(200);
    const reader = stream.body!.getReader();

    // Record the order: the database pool must still be open while the HTTP server closes.
    const prisma = app.get(PrismaService);
    const order: string[] = [];
    const server = app.getHttpServer();
    server.once('close', () => order.push('http closed'));
    const disconnect = prisma.$disconnect.bind(prisma);
    prisma.$disconnect = async () => {
      order.push('database closed');
      await disconnect();
    };

    const started = Date.now();
    await app.close();
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(order).toEqual(['http closed', 'database closed']);

    // The stream was ended by the server, not left hanging.
    for (;;) {
      const { done } = await reader.read();
      if (done) break;
    }
  });
});
