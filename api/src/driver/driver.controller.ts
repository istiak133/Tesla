import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { PublicUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard.js';
import { Role } from '../generated/prisma/client.js';
import { DriverService } from './driver.service.js';

// Driver endpoints. Every route needs a session and the DRIVER role.
@Controller('driver')
@UseGuards(SessionAuthGuard, RolesGuard)
@Roles(Role.DRIVER)
export class DriverController {
  constructor(private readonly driverService: DriverService) {}

  // GET /driver/pool → my vehicle and current trip
  @Get('pool')
  currentPool(@CurrentUser() user: PublicUser) {
    return this.driverService.getCurrentPool(user.id);
  }

  // POST /driver/online and /driver/offline
  @Post('online')
  @HttpCode(200)
  async goOnline(@CurrentUser() user: PublicUser) {
    await this.driverService.setOnline(user.id, true);
    return this.driverService.getCurrentPool(user.id);
  }

  @Post('offline')
  @HttpCode(200)
  async goOffline(@CurrentUser() user: PublicUser) {
    await this.driverService.setOnline(user.id, false);
    return this.driverService.getCurrentPool(user.id);
  }

  // GET /driver/requests → waiting requests, with whether I can accept each
  @Get('requests')
  waitingRequests(@CurrentUser() user: PublicUser) {
    return this.driverService.listWaitingRequests(user.id);
  }

  // POST /driver/requests/:id/accept
  @Post('requests/:id/accept')
  @HttpCode(200)
  accept(
    @CurrentUser() user: PublicUser,
    @Param('id', ParseUUIDPipe) rideId: string,
  ) {
    return this.driverService.acceptRequest(user.id, rideId);
  }
}
