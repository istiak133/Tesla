import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DriverController } from '../driver/driver.controller.js';
import { DriverService } from '../driver/driver.service.js';
import { GeographyModule } from '../geography/geography.module.js';
import { PoolingService } from './pooling.service.js';
import { RidesController } from './rides.controller.js';
import { RidesRepository } from './rides.repository.js';
import { RidesService } from './rides.service.js';

@Module({
  imports: [AuthModule, GeographyModule],
  controllers: [RidesController, DriverController],
  providers: [RidesRepository, PoolingService, RidesService, DriverService],
})
export class RidesModule {}
