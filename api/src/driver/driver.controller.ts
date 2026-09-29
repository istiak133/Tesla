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
import { ChooseRouteDto } from './dto/choose-route.dto.js';
import { SetLocationDto } from './dto/set-location.dto.js';
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

  // GET /driver/routes → every route ranked from where I am, with the suggested one
  @Get('routes')
  routeSuggestions(@CurrentUser() user: PublicUser) {
    return this.driverService.suggestRoutes(user.id);
  }

  // POST /driver/location → where my car is (only between trips; stops update it after that)
  @Post('location')
  @HttpCode(200)
  async setLocation(
    @CurrentUser() user: PublicUser,
    @Body() body: SetLocationDto,
  ) {
    await this.driverService.setLocation(user.id, body.zoneId);
    return this.driverService.getCurrentPool(user.id);
  }

  // POST /driver/route → the route I drive (only between trips)
  @Post('route')
  @HttpCode(200)
  async chooseRoute(
    @CurrentUser() user: PublicUser,
    @Body() body: ChooseRouteDto,
  ) {
    await this.driverService.chooseRoute(user.id, body.routeId);
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

  // The trip, stop by stop: arrive → pick up / drop off / no-show → depart → arrive …
  // Any other order is rejected with 409 INVALID_TRANSITION.
  @Post('pool/arrive')
  @HttpCode(200)
  arrive(@CurrentUser() user: PublicUser) {
    return this.tripService.arrive(user.id);
  }

  @Post('pool/depart')
  @HttpCode(200)
  depart(@CurrentUser() user: PublicUser) {
    return this.tripService.depart(user.id);
  }

  @Post('pool/passengers/:rideId/pickup')
  @HttpCode(200)
  pickUp(
    @CurrentUser() user: PublicUser,
    @Param('rideId', ParseUUIDPipe) rideId: string,
  ) {
    return this.tripService.pickUp(user.id, rideId);
  }

  @Post('pool/passengers/:rideId/dropoff')
  @HttpCode(200)
  dropOff(
    @CurrentUser() user: PublicUser,
    @Param('rideId', ParseUUIDPipe) rideId: string,
  ) {
    return this.tripService.dropOff(user.id, rideId);
  }

  @Post('pool/passengers/:rideId/no-show')
  @HttpCode(200)
  noShow(
    @CurrentUser() user: PublicUser,
    @Param('rideId', ParseUUIDPipe) rideId: string,
  ) {
    return this.tripService.noShow(user.id, rideId);
  }

  // Before the first pickup only: passengers go back to waiting for another driver.
  @Post('pool/cancel')
  @HttpCode(200)
  cancelTrip(@CurrentUser() user: PublicUser) {
    return this.tripService.cancelTrip(user.id);
  }
}
