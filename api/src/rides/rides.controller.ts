import {
  Body,
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
import { RequestRideDto } from './dto/request-ride.dto.js';
import { RidesService } from './rides.service.js';

// Passenger endpoints. Every route needs a session and the PASSENGER role.
@Controller('rides')
@UseGuards(SessionAuthGuard, RolesGuard)
@Roles(Role.PASSENGER)
export class RidesController {
  constructor(private readonly ridesService: RidesService) {}

  // POST /rides → request a ride (joins an open pool at once if one fits)
  @Post()
  requestRide(@CurrentUser() user: PublicUser, @Body() body: RequestRideDto) {
    return this.ridesService.requestRide(
      user.id,
      body.pickupZoneId,
      body.dropoffZoneId,
      body.seats,
    );
  }

  // GET /rides/current → the active ride, or null
  @Get('current')
  async current(@CurrentUser() user: PublicUser) {
    return { ride: await this.ridesService.getCurrentRide(user.id) };
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
  ) {
    return this.ridesService.cancelRide(user.id, rideId);
  }
}
