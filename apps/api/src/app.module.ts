import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';

import { ApiThrottlerGuard } from './common/security/api-throttler.guard';
import { AppConfigModule } from './config/app-config.module';
import { AppConfig } from './config/app-config.service';
import { AssistantModule } from './modules/assistant/assistant.module';
import { BehaviorModule } from './modules/behavior/behavior.module';
import { AuthModule } from './modules/auth/auth.module';
import { DailyPlansModule } from './modules/daily-plans/daily-plans.module';
import { FocusModule } from './modules/focus/focus.module';
import { HealthModule } from './modules/health/health.module';
import { InboxModule } from './modules/inbox/inbox.module';
import { InvalidationsModule } from './modules/invalidations/invalidations.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { PrivacyModule } from './modules/privacy/privacy.module';
import { ReviewsModule } from './modules/reviews/reviews.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    AppConfigModule,
    ThrottlerModule.forRootAsync({
      imports: [AppConfigModule],
      inject: [AppConfig],
      useFactory: (config: AppConfig) => [
        {
          limit: config.apiRateLimitPerMinute,
          ttl: 60_000,
        },
      ],
    }),
    AssistantModule,
    BehaviorModule,
    AuthModule,
    DailyPlansModule,
    FocusModule,
    HealthModule,
    InboxModule,
    InvalidationsModule,
    ProjectsModule,
    PrivacyModule,
    ReviewsModule,
    TasksModule,
    UsersModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ApiThrottlerGuard }],
})
export class AppModule {}
