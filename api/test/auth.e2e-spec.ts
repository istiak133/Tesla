import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma.service.js';
import { createTestApp, resetDatabase, zoneId } from './helpers/test-app.js';

// Sign-up and login for both kinds of user (D-015).
const nusrat = {
  name: '  Nusrat   Jahan ',
  email: 'Nusrat@TeslaPool.test', // mixed case on purpose
  phone: '01712-345678', // local form on purpose
  password: 'tesla1234',
  presentAddress: 'House 21, Road 11, Banani, Dhaka 1213',
  permanentAddress: 'Zindabazar, Sylhet',
};

const jashim = {
  name: 'Jashim Uddin',
  email: 'jashim.new@teslapool.test',
  phone: '+880 1911 223344',
  password: 'jashim-pass-1',
  presentAddress: 'House 7, Road 11, Banani, Dhaka 1213',
  permanentAddress: 'Char Kalia, Kishoreganj',
  idType: 'NID',
  idNumber: '19901234567890123',
  licenceNumber: 'dk-0123456 c00001',
  vehicleName: 'Thunder',
  plateNumber: ' dhaka metro-ga 12-3456 ',
};

describe('Auth (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const server = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(app);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('passengers', () => {
    it('signs up with contact details, stays logged in with the cookie, and logs out', async () => {
      const agent = request.agent(app.getHttpServer()); // keeps cookies between requests

      const signup = await agent.post('/auth/signup/passenger').send(nusrat);
      expect(signup.status).toBe(201);
      expect(signup.body).toMatchObject({
        name: 'Nusrat Jahan',
        email: 'nusrat@teslapool.test',
        role: 'PASSENGER',
      });
      expect(signup.body.passwordHash).toBeUndefined();
      const cookie = signup.headers['set-cookie']?.[0] ?? '';
      expect(cookie).toContain('tesla_session=');
      expect(cookie).toContain('HttpOnly');

      const saved = await prisma.user.findUniqueOrThrow({
        where: { email: 'nusrat@teslapool.test' },
      });
      expect(saved).toMatchObject({
        phone: '+8801712345678',
        presentAddress: 'House 21, Road 11, Banani, Dhaka 1213',
        permanentAddress: 'Zindabazar, Sylhet',
      });

      expect((await agent.get('/auth/me')).body.email).toBe(
        'nusrat@teslapool.test',
      );
      expect((await agent.post('/auth/logout')).status).toBe(204);
      expect((await agent.get('/auth/me')).status).toBe(401);
    });

    it('refuses a second account with the same email or phone, however it is written', async () => {
      await server().post('/auth/signup/passenger').send(nusrat).expect(201);

      const sameEmail = await server()
        .post('/auth/signup/passenger')
        .send({
          ...nusrat,
          email: 'nusrat@teslapool.test',
          phone: '01812345678',
        });
      expect(sameEmail.status).toBe(409);
      expect(sameEmail.body).toMatchObject({
        code: 'ALREADY_REGISTERED',
        field: 'email',
      });

      const samePhone = await server()
        .post('/auth/signup/passenger')
        .send({
          ...nusrat,
          email: 'other@teslapool.test',
          phone: '+8801712345678',
        });
      expect(samePhone.status).toBe(409);
      expect(samePhone.body).toMatchObject({
        field: 'phone',
        message: 'Phone number is already registered',
      });
    });

    it('refuses bad input, and never lets a client choose its role or driver fields', async () => {
      const bad = (changes: object) =>
        server()
          .post('/auth/signup/passenger')
          .send({ ...nusrat, ...changes });
      expect((await bad({ password: 'short' })).status).toBe(400);
      expect((await bad({ phone: '01212345678' })).status).toBe(400); // not a mobile operator
      expect((await bad({ phone: '+441712345678' })).status).toBe(400);
      expect((await bad({ presentAddress: '' })).status).toBe(400);
      expect((await bad({ permanentAddress: undefined })).status).toBe(400);
      expect((await bad({ role: 'DRIVER' })).status).toBe(400);
      expect((await bad({ licenceNumber: 'DK0123456C00001' })).status).toBe(
        400,
      );
      expect(await prisma.user.count()).toBe(0);
    });
  });

  describe('drivers', () => {
    it('signs up with an NID, a licence and a car: all saved together, cleaned up', async () => {
      const agent = request.agent(app.getHttpServer());
      const signup = await agent.post('/auth/signup/driver').send(jashim);
      expect(signup.status).toBe(201);
      expect(signup.body).toMatchObject({
        role: 'DRIVER',
        name: 'Jashim Uddin',
      });

      const saved = await prisma.user.findUniqueOrThrow({
        where: { email: jashim.email },
        include: { driverProfile: true, vehicle: true },
      });
      expect(saved.phone).toBe('+8801911223344');
      expect(saved.driverProfile).toMatchObject({
        idType: 'NID',
        idNumber: '19901234567890123',
        licenceNumber: 'DK0123456C00001',
      });
      expect(saved.vehicle).toMatchObject({
        name: 'Thunder',
        plateNumber: 'DHAKA METRO-GA 12-3456',
        seatCapacity: 3,
        isOnline: false,
        routeId: null,
        currentZoneId: null,
      });
      expect((await agent.get('/driver/pool')).status).toBe(200); // a driver at once
    });

    it('can sign up with a passport instead of an NID', async () => {
      const signup = await server()
        .post('/auth/signup/driver')
        .send({ ...jashim, idType: 'PASSPORT', idNumber: 'a0123 4567' });
      expect(signup.status).toBe(201);
      const profile = await prisma.driverProfile.findFirstOrThrow();
      expect(profile).toMatchObject({
        idType: 'PASSPORT',
        idNumber: 'A01234567',
      });
    });

    it('checks the number against the document chosen', async () => {
      const bad = async (changes: object) =>
        (
          await server()
            .post('/auth/signup/driver')
            .send({ ...jashim, ...changes })
        ).body;
      expect(
        (await bad({ idType: 'PASSPORT', idNumber: '1234567890' })).message,
      ).toContain('Passport number must look like A01234567');
      expect(
        (await bad({ idType: 'NID', idNumber: 'A01234567' })).message,
      ).toContain('NID number must be 10, 13 or 17 digits');
      expect((await bad({ idType: undefined })).statusCode).toBe(400);
      expect((await bad({ idType: 'LICENCE' })).statusCode).toBe(400);
      expect((await bad({ licenceNumber: 'DK1' })).statusCode).toBe(400);
      expect((await bad({ plateNumber: '-' })).statusCode).toBe(400);
      expect((await bad({ vehicleName: undefined })).statusCode).toBe(400);
      expect(await prisma.user.count()).toBe(0);
    });

    it('refuses a document, licence or plate already used, and leaves nothing half made', async () => {
      await server().post('/auth/signup/driver').send(jashim).expect(201);
      const another = {
        ...jashim,
        email: 'second@teslapool.test',
        phone: '01911000000',
        idNumber: '1234567890',
        licenceNumber: 'DK9999999C00009',
        plateNumber: 'DHAKA METRO-KA 99-9999',
      };
      const tries: [object, string][] = [
        [{ idNumber: jashim.idNumber }, 'idNumber'],
        [{ licenceNumber: 'DK0123456C00001' }, 'licenceNumber'],
        [{ plateNumber: 'Dhaka Metro-GA 12-3456' }, 'plateNumber'],
      ];
      for (const [changes, field] of tries) {
        const response = await server()
          .post('/auth/signup/driver')
          .send({ ...another, ...changes });
        expect(response.status).toBe(409);
        expect(response.body.field).toBe(field);
      }
      expect(await prisma.user.count()).toBe(1);
      expect(await prisma.vehicle.count()).toBe(1);
      expect(await prisma.driverProfile.count()).toBe(1);
      // The unique indexes hold even without the service check.
      await expect(
        prisma.vehicle.create({
          data: {
            driverId: (await prisma.user.findFirstOrThrow()).id,
            name: 'Copy',
            seatCapacity: 3,
            plateNumber: 'DHAKA METRO-GA 12-3456',
          },
        }),
      ).rejects.toThrow();
    });

    it('a new driver sets location and route, goes online, and takes a real ride', async () => {
      const driver = request.agent(app.getHttpServer());
      await driver.post('/auth/signup/driver').send(jashim).expect(201);
      const rider = request.agent(app.getHttpServer());
      await rider.post('/auth/signup/passenger').send(nusrat).expect(201);

      const [BAN, MOH] = await Promise.all([
        zoneId(app, 'BAN'),
        zoneId(app, 'MOH'),
      ]);
      const route = await prisma.route.findUniqueOrThrow({
        where: { code: 'UTT-BSH' },
      });
      expect((await driver.post('/driver/online')).status).toBe(409); // no route yet
      await driver.post('/driver/location').send({ zoneId: BAN }).expect(200);
      await driver
        .post('/driver/route')
        .send({ routeId: route.id })
        .expect(200);
      await driver.post('/driver/online').expect(200);

      const ride = await rider
        .post('/rides')
        .send({ pickupZoneId: BAN, dropoffZoneId: MOH, seats: 1 });
      const accepted = await driver.post(
        `/driver/requests/${ride.body.id}/accept`,
      );
      expect(accepted.status).toBe(200);
      expect(accepted.body.pool.seatsTaken).toBe(1);
      expect((await rider.get('/rides/current')).body.ride.status).toBe(
        'MATCHED',
      );
    });
  });

  describe('login with the account type', () => {
    beforeEach(async () => {
      await server().post('/auth/signup/passenger').send(nusrat).expect(201);
      await server().post('/auth/signup/driver').send(jashim).expect(201);
    });

    const login = (role: string | undefined, email: string, password: string) =>
      server().post('/auth/login').send({ role, email, password });

    it('logs in with the right type and password', async () => {
      expect(
        (await login('PASSENGER', 'NUSRAT@teslapool.test', 'tesla1234')).status,
      ).toBe(200);
      expect(
        (await login('DRIVER', jashim.email, jashim.password)).body.role,
      ).toBe('DRIVER');
    });

    it('gives the same answer for a wrong password or an unknown email', async () => {
      const wrong = await login(
        'PASSENGER',
        'nusrat@teslapool.test',
        'wrong-password',
      );
      const unknown = await login(
        'PASSENGER',
        'nobody@teslapool.test',
        'tesla1234',
      );
      expect(wrong.status).toBe(401);
      expect(unknown.status).toBe(401);
      expect(wrong.body.message).toBe('Invalid email or password');
      expect(unknown.body.message).toBe(wrong.body.message);
    });

    it('says which type to choose only after the password matched, and gives no session', async () => {
      const asDriver = await login(
        'DRIVER',
        'nusrat@teslapool.test',
        'tesla1234',
      );
      expect(asDriver.status).toBe(401);
      expect(asDriver.body).toMatchObject({
        code: 'WRONG_ACCOUNT_TYPE',
        message: 'This is a passenger account: choose Passenger to log in',
      });
      expect(asDriver.headers['set-cookie']).toBeUndefined();

      const asPassenger = await login(
        'PASSENGER',
        jashim.email,
        jashim.password,
      );
      expect(asPassenger.body.message).toBe(
        'This is a driver account: choose Driver to log in',
      );

      const wrongBoth = await login(
        'DRIVER',
        'nusrat@teslapool.test',
        'nope-nope',
      );
      expect(wrongBoth.body.message).toBe('Invalid email or password');
    });

    it('needs the account type', async () => {
      expect(
        (await login(undefined, 'nusrat@teslapool.test', 'tesla1234')).status,
      ).toBe(400);
      expect(
        (await login('ADMIN', 'nusrat@teslapool.test', 'tesla1234')).status,
      ).toBe(400);
    });

    it('rejects requests without a valid session cookie', async () => {
      expect((await server().get('/auth/me')).status).toBe(401);
      const fake = await server()
        .get('/auth/me')
        .set('Cookie', 'tesla_session=not-a-real-token');
      expect(fake.status).toBe(401);
    });
  });
});
