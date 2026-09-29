import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { IdDocumentType, Role, User } from '../generated/prisma/client.js';

/** A detail that only one account may have. */
export type RegisteredField =
  'email' | 'phone' | 'idNumber' | 'licenceNumber' | 'plateNumber';

/** What both kinds of user give at sign-up (D-015). */
export type NewUser = {
  name: string;
  email: string;
  phone: string;
  passwordHash: string;
  presentAddress: string;
  permanentAddress: string;
};

/** What only a driver gives, and the car they drive. */
export type NewDriverDetails = {
  idType: IdDocumentType;
  idNumber: string;
  licenceNumber: string;
  vehicleName: string;
  plateNumber: string;
  seatCapacity: number;
};

@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  /**
   * The first detail another account already uses, or null. Checked in this order so the
   * message is about the field people most often mistype. The unique indexes still decide
   * if two sign-ups race past this check.
   */
  async findRegisteredField(
    user: Pick<NewUser, 'email' | 'phone'>,
    driver?: Pick<
      NewDriverDetails,
      'idType' | 'idNumber' | 'licenceNumber' | 'plateNumber'
    >,
  ): Promise<RegisteredField | null> {
    if (await this.prisma.user.findUnique({ where: { email: user.email } })) {
      return 'email';
    }
    if (await this.prisma.user.findUnique({ where: { phone: user.phone } })) {
      return 'phone';
    }
    if (driver === undefined) {
      return null;
    }
    const sameDocument = await this.prisma.driverProfile.findUnique({
      where: {
        idType_idNumber: { idType: driver.idType, idNumber: driver.idNumber },
      },
    });
    if (sameDocument) {
      return 'idNumber';
    }
    const sameLicence = await this.prisma.driverProfile.findUnique({
      where: { licenceNumber: driver.licenceNumber },
    });
    if (sameLicence) {
      return 'licenceNumber';
    }
    const samePlate = await this.prisma.vehicle.findUnique({
      where: { plateNumber: driver.plateNumber },
    });
    if (samePlate) {
      return 'plateNumber';
    }
    return null;
  }

  async createPassenger(data: NewUser): Promise<User> {
    return this.prisma.user.create({
      data: { ...data, role: Role.PASSENGER },
    });
  }

  /**
   * The driver, their documents and their vehicle in one insert (one transaction):
   * either all three exist or none. The vehicle starts offline, with no route or location;
   * the driver sets both on the driver page before the first trip.
   */
  async createDriver(user: NewUser, driver: NewDriverDetails): Promise<User> {
    return this.prisma.user.create({
      data: {
        ...user,
        role: Role.DRIVER,
        driverProfile: {
          create: {
            idType: driver.idType,
            idNumber: driver.idNumber,
            licenceNumber: driver.licenceNumber,
          },
        },
        vehicle: {
          create: {
            name: driver.vehicleName,
            plateNumber: driver.plateNumber,
            seatCapacity: driver.seatCapacity,
          },
        },
      },
    });
  }
}
