import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { EventsController } from './events.controller.js';
import { PublishChangesInterceptor } from './publish-changes.interceptor.js';
import { RealtimeService } from './realtime.service.js';

/** Live updates over Server-Sent Events (decision D-020). */
@Global()
@Module({
  imports: [AuthModule],
  controllers: [EventsController],
  providers: [RealtimeService, PublishChangesInterceptor],
  exports: [RealtimeService, PublishChangesInterceptor],
})
export class RealtimeModule {}
