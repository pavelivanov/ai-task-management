import { Module } from '@nestjs/common';

import { AppConfigModule } from '../../config/app-config.module';
import { DatabaseModule } from '../../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { DailyPlansModule } from '../daily-plans/daily-plans.module';
import { InvalidationsModule } from '../invalidations/invalidations.module';
import { TasksModule } from '../tasks/tasks.module';
import {
  FOCUS_ACTIVATION_HOOK,
  NoopFocusActivationHook,
} from './focus-activation.hook';
import { FocusController } from './focus.controller';
import { FocusService } from './focus.service';

@Module({
  imports: [
    AppConfigModule,
    AuthModule,
    DailyPlansModule,
    DatabaseModule,
    InvalidationsModule,
    TasksModule,
  ],
  controllers: [FocusController],
  providers: [
    FocusService,
    { provide: FOCUS_ACTIVATION_HOOK, useClass: NoopFocusActivationHook },
  ],
  exports: [FocusService, FOCUS_ACTIVATION_HOOK],
})
export class FocusModule {}
