import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { PublicUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard.js';
import { Role } from '../generated/prisma/client.js';
import { PublishChangesInterceptor } from '../realtime/publish-changes.interceptor.js';
import { CancelRideDto } from './dto/cancel-ride.dto.js';
import { RequestRideDto } from './dto/request-ride.dto.js';
import { RidesService } from './rides.service.js';

// Passenger endpoints. Every route needs a session and the PASSENGER role.
@Controller('rides')
@UseGuards(SessionAuthGuard, RolesGuard)
@Roles(Role.PASSENGER)
// Every successful action tells open screens to refresh (live updates, D-020).
@UseInterceptors(PublishChangesInterceptor)
export class RidesController {
  constructor(private readonly ridesService: RidesService) {}

  // POST /rides → request a ride: answers REQUESTED; the next match round seats it if a
  // running trip fits
  @Post()
  requestRide(@CurrentUser() user: PublicUser, @Body() body: RequestRideDto) {
    return this.ridesService.requestRide(
      user.id,
      body.pickupZoneId,
      body.dropoffZoneId,
      body.seats,
    );
  }

  // GET /rides/current → the active ride, or null; with no active ride, the one that ended in
  // the last 30 minutes (the fare to pay, or why it ended), or null
  @Get('current')
  async current(@CurrentUser() user: PublicUser) {
    const ride = await this.ridesService.getCurrentRide(user.id);
    return {
      ride,
      lastEnded:
        ride === null
          ? await this.ridesService.getRecentlyEndedRide(user.id)
          : null,
    };
  }

  // GET /rides → ride history, newest first
  @Get()
  history(@CurrentUser() user: PublicUser) {
    return this.ridesService.listHistory(user.id);
  }

  // GET /rides/:id → one of my rides, with its status history
  @Get(':id')
  getRide(
    @CurrentUser() user: PublicUser,
    @Param('id', ParseUUIDPipe) rideId: string,
  ) {
    return this.ridesService.getRide(user.id, rideId);
  }

  // POST /rides/:id/cancel → cancel before the trip starts
  @Post(':id/cancel')
  @HttpCode(200)
  cancel(
    @CurrentUser() user: PublicUser,
    @Param('id', ParseUUIDPipe) rideId: string,
    @Body() body: CancelRideDto,
  ) {
    return this.ridesService.cancelRide(user.id, rideId, body.expectedFeePaisa);
  }
}
