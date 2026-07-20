import { Module } from '@nestjs/common';

import { AppConfigModule } from '../../config/app-config.module';
import { DatabaseModule } from '../../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { TasksModule } from '../tasks/tasks.module';
import { DailyPlansController } from './daily-plans.controller';
import { DailyPlansService } from './daily-plans.service';
import {
  DAILY_PLAN_CLOSE_GUARD,
  NoActiveFocusSessionCloseGuard,
} from './plan-close.guard';

@Module({
  imports: [AppConfigModule, AuthModule, DatabaseModule, TasksModule],
  controllers: [DailyPlansController],
  providers: [
    DailyPlansService,
    {
      provide: DAILY_PLAN_CLOSE_GUARD,
      useClass: NoActiveFocusSessionCloseGuard,
    },
  ],
  exports: [DailyPlansService, DAILY_PLAN_CLOSE_GUARD],
})
export class DailyPlansModule {}
