import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { User } from '../generated/prisma/client.js';

@Injectable()
export class SessionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, tokenHash: string, expiresAt: Date) {
    await this.prisma.session.create({
      data: { userId, tokenHash, expiresAt },
    });
  }

  /** The user of a session that exists and has not expired, or null. */
  async findUserByValidToken(tokenHash: string): Promise<User | null> {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (session === null) {
      return null;
    }
    if (session.expiresAt <= new Date()) {
      return null;
    }
    return session.user;
  }

  async deleteByToken(tokenHash: string) {
    await this.prisma.session.deleteMany({ where: { tokenHash } });
  }
}
