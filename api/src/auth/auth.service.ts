import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/env.validation.js';
import type { IdDocumentType, Role, User } from '../generated/prisma/client.js';
import {
  type NewDriverDetails,
  type NewUser,
  UsersRepository,
} from '../users/users.repository.js';
import {
  AlreadyRegisteredError,
  InvalidCredentialsError,
  WrongAccountTypeError,
} from './auth.errors.js';
import { PublicUser, toPublicUser } from './auth.types.js';
import { hashPassword, verifyPassword } from './password.js';
import { generateSessionToken, hashSessionToken } from './session-token.js';
import { SessionsRepository } from './sessions.repository.js';

/** Sign-up details, already tidied and checked by the DTO (D-015). */
export type SignupInput = {
  name: string;
  email: string;
  phone: string;
  password: string;
  presentAddress: string;
  permanentAddress: string;
};

export type DriverSignupInput = SignupInput & {
  idType: IdDocumentType;
  idNumber: string;
  licenceNumber: string;
  vehicleName: string;
  plateNumber: string;
};

// Every Tesla in the pool offers three passenger seats (docs/assumptions.md).
export const DRIVER_VEHICLE_SEATS = 3;

export type LoginResult = {
  user: PublicUser;
  // Raw token for the cookie. Only its hash is stored.
  sessionToken: string;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly sessionsRepository: SessionsRepository,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  /** Creates a passenger account and logs it in. */
  async signupPassenger(input: SignupInput): Promise<LoginResult> {
    const user = await this.newUser(input);
    await this.refuseRegistered(user);
    // If two sign-ups with the same details race past the check above,
    // a unique index makes the second insert fail (see AuthController).
    const created = await this.usersRepository.createPassenger(user);
    return this.loggedIn(created);
  }

  /** Creates a driver account with their documents and vehicle, and logs it in (D-015). */
  async signupDriver(input: DriverSignupInput): Promise<LoginResult> {
    const user = await this.newUser(input);
    const driver = {
      idType: input.idType,
      idNumber: input.idNumber,
      licenceNumber: input.licenceNumber,
      vehicleName: input.vehicleName,
      plateNumber: input.plateNumber,
      seatCapacity: DRIVER_VEHICLE_SEATS,
    };
    await this.refuseRegistered(user, driver);
    const created = await this.usersRepository.createDriver(user, driver);
    return this.loggedIn(created);
  }

  /**
   * Logs in only with the account type chosen on the login page. The type is compared
   * after the password, so a wrong type tells nothing to someone without the password.
   */
  async login(
    role: Role,
    email: string,
    password: string,
  ): Promise<LoginResult> {
    const user = await this.usersRepository.findByEmail(normalizeEmail(email));
    if (user === null) {
      throw new InvalidCredentialsError();
    }

    const passwordMatches = await verifyPassword(password, user.passwordHash);
    if (!passwordMatches) {
      throw new InvalidCredentialsError();
    }
    if (user.role !== role) {
      throw new WrongAccountTypeError(user.role);
    }

    return this.loggedIn(user);
  }

  async logout(sessionToken: string): Promise<void> {
    await this.sessionsRepository.deleteByToken(hashSessionToken(sessionToken));
  }

  private async newUser(input: SignupInput): Promise<NewUser> {
    return {
      name: input.name,
      email: normalizeEmail(input.email),
      phone: input.phone,
      passwordHash: await hashPassword(input.password),
      presentAddress: input.presentAddress,
      permanentAddress: input.permanentAddress,
    };
  }

  private async refuseRegistered(
    user: NewUser,
    driver?: NewDriverDetails,
  ): Promise<void> {
    const taken = await this.usersRepository.findRegisteredField(user, driver);
    if (taken !== null) {
      throw new AlreadyRegisteredError(taken);
    }
  }

  private async loggedIn(user: User): Promise<LoginResult> {
    const sessionToken = await this.startSession(user.id);
    return { user: toPublicUser(user), sessionToken };
  }

  private async startSession(userId: string): Promise<string> {
    const token = generateSessionToken();
    const ttlHours = this.config.get('SESSION_TTL_HOURS', { infer: true });
    const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

    await this.sessionsRepository.create(
      userId,
      hashSessionToken(token),
      expiresAt,
    );
    return token;
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
