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
import { TripService } from './trip.service.js';

// Driver endpoints. Every route needs a session and the DRIVER role.
@Controller('driver')
@UseGuards(SessionAuthGuard, RolesGuard)
@Roles(Role.DRIVER)
export class DriverController {
  constructor(
    private readonly driverService: DriverService,
    private readonly tripService: TripService,
  ) {}

  // GET /driver/pool → my vehicle and current trip
  @Get('pool')
  currentPool(@CurrentUser() user: PublicUser) {
    return this.driverService.getCurrentPool(user.id);
  }

  // GET /driver/trips → my past trips (completed or cancelled)
  @Get('trips')
  pastTrips(@CurrentUser() user: PublicUser) {
    return this.driverService.listPastTrips(user.id);
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

  // Trip lifecycle: MATCHED → DRIVER_ARRIVED → STARTED → COMPLETED (409 for any other order)
  @Post('pool/arrive')
  @HttpCode(200)
  arrive(@CurrentUser() user: PublicUser) {
    return this.tripService.arrive(user.id);
  }

  @Post('pool/start')
  @HttpCode(200)
  start(@CurrentUser() user: PublicUser) {
    return this.tripService.start(user.id);
  }

  @Post('pool/complete')
  @HttpCode(200)
  complete(@CurrentUser() user: PublicUser) {
    return this.tripService.complete(user.id);
  }

  // Before the start only: passengers go back to waiting for another driver.
  @Post('pool/cancel')
  @HttpCode(200)
  cancelTrip(@CurrentUser() user: PublicUser) {
    return this.tripService.cancelTrip(user.id);
  }
}
