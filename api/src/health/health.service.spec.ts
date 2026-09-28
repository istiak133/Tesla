import { Test } from '@nestjs/testing';
import { HealthRepository } from './health.repository.js';
import { HealthService } from './health.service.js';

// Builds a HealthService whose repository is a fake,
// so these tests do not need a real database.
async function createService(databaseIsUp: boolean): Promise<HealthService> {
  const fakeRepository = {
    isDatabaseReachable: async () => databaseIsUp,
  };

  const moduleRef = await Test.createTestingModule({
    providers: [
      HealthService,
      { provide: HealthRepository, useValue: fakeRepository },
    ],
  }).compile();

  return moduleRef.get(HealthService);
}

describe('HealthService', () => {
  it('reports ok when the database is reachable', async () => {
    const service = await createService(true);

    expect(await service.check()).toEqual({ status: 'ok', database: 'up' });
  });

  it('reports an error when the database is not reachable', async () => {
    const service = await createService(false);

    expect(await service.check()).toEqual({
      status: 'error',
      database: 'down',
    });
  });
});
