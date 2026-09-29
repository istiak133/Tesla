import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/env.validation.js';
import { UsersRepository } from '../users/users.repository.js';
import {
  EmailAlreadyRegisteredError,
  InvalidCredentialsError,
} from './auth.errors.js';
import { PublicUser, toPublicUser } from './auth.types.js';
import { hashPassword, verifyPassword } from './password.js';
import { generateSessionToken, hashSessionToken } from './session-token.js';
import { SessionsRepository } from './sessions.repository.js';

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

  /** Creates a passenger account and logs it in. Drivers are created by the seed. */
  async signup(
    name: string,
    email: string,
    password: string,
  ): Promise<LoginResult> {
    const normalizedEmail = normalizeEmail(email);

    const existing = await this.usersRepository.findByEmail(normalizedEmail);
    if (existing !== null) {
      throw new EmailAlreadyRegisteredError();
    }

    const passwordHash = await hashPassword(password);
    // If two sign-ups with the same email race past the check above,
    // the unique index on users.email makes the second insert fail (see AuthController).
    const user = await this.usersRepository.createPassenger({
      name: name.trim(),
      email: normalizedEmail,
      passwordHash,
    });

    const sessionToken = await this.startSession(user.id);
    return { user: toPublicUser(user), sessionToken };
  }

  async login(email: string, password: string): Promise<LoginResult> {
    const user = await this.usersRepository.findByEmail(normalizeEmail(email));
    if (user === null) {
      throw new InvalidCredentialsError();
    }

    const passwordMatches = await verifyPassword(password, user.passwordHash);
    if (!passwordMatches) {
      throw new InvalidCredentialsError();
    }

    const sessionToken = await this.startSession(user.id);
    return { user: toPublicUser(user), sessionToken };
  }

  async logout(sessionToken: string): Promise<void> {
    await this.sessionsRepository.deleteByToken(hashSessionToken(sessionToken));
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
