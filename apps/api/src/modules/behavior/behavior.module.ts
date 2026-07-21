import { Module } from '@nestjs/common';

import { AppConfig } from '../../config/app-config.service';
import { AppConfigModule } from '../../config/app-config.module';
import { DatabaseModule } from '../../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { InvalidationsModule } from '../invalidations/invalidations.module';
import { BehaviorSchedulerService } from './behavior-scheduler.service';
import { BehaviorController } from './behavior.controller';
import { BehaviorService } from './behavior.service';
import { DisabledPushGateway } from './disabled-push.gateway';
import { FakePushGateway } from './fake-push.gateway';
import { NotificationWorkerService } from './notification-worker.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { PUSH_GATEWAY } from './push-gateway';
import { WebPushGateway } from './web-push.gateway';

@Module({
  imports: [AppConfigModule, AuthModule, DatabaseModule, InvalidationsModule],
  controllers: [BehaviorController, NotificationsController],
  providers: [
    BehaviorService,
    BehaviorSchedulerService,
    NotificationsService,
    NotificationWorkerService,
    {
      provide: PUSH_GATEWAY,
      inject: [AppConfig],
      useFactory: (config: AppConfig) => {
        if (config.pushProvider === 'fake') return new FakePushGateway();
        if (config.pushProvider === 'web-push')
          return new WebPushGateway(config);
        return new DisabledPushGateway();
      },
    },
  ],
  exports: [
    BehaviorService,
    BehaviorSchedulerService,
    NotificationsService,
    NotificationWorkerService,
    PUSH_GATEWAY,
  ],
})
export class BehaviorModule {}
