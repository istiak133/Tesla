import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { RolesGuard } from './guards/roles.guard.js';
import { SessionAuthGuard } from './guards/session-auth.guard.js';
import { SessionsRepository } from './sessions.repository.js';

@Module({
  imports: [UsersModule],
  controllers: [AuthController],
  providers: [AuthService, SessionsRepository, SessionAuthGuard, RolesGuard],
  // Other feature modules import AuthModule to protect their routes.
  exports: [SessionAuthGuard, RolesGuard, SessionsRepository],
})
export class AuthModule {}
