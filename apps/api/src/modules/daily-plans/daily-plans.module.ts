import { Module } from '@nestjs/common';

import { AppConfigModule } from '../../config/app-config.module';
import { DatabaseModule } from '../../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { InvalidationsModule } from '../invalidations/invalidations.module';
import { ReviewsModule } from '../reviews/reviews.module';
import { TasksModule } from '../tasks/tasks.module';
import { DailyPlansController } from './daily-plans.controller';
import { DailyPlansService } from './daily-plans.service';
import {
  DAILY_PLAN_CLOSE_GUARD,
  ActiveFocusSessionCloseGuard,
} from './plan-close.guard';

@Module({
  imports: [
    AppConfigModule,
    AuthModule,
    DatabaseModule,
    InvalidationsModule,
    ReviewsModule,
    TasksModule,
  ],
  controllers: [DailyPlansController],
  providers: [
    DailyPlansService,
    {
      provide: DAILY_PLAN_CLOSE_GUARD,
      useClass: ActiveFocusSessionCloseGuard,
    },
  ],
  exports: [DailyPlansService, DAILY_PLAN_CLOSE_GUARD],
})
export class DailyPlansModule {}
