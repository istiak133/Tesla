import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';

/**
 * The only part of the health feature that talks to the database.
 */
@Injectable()
export class HealthRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Runs the smallest possible query.
   * Returns true if the database answered, false if it did not.
   */
  async isDatabaseReachable(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
