import { Module } from '@nestjs/common';
import { GeographyController } from './geography.controller.js';
import { GeographyRepository } from './geography.repository.js';
import { GeographyService } from './geography.service.js';

@Module({
  controllers: [GeographyController],
  providers: [GeographyService, GeographyRepository],
  exports: [GeographyRepository],
})
export class GeographyModule {}
