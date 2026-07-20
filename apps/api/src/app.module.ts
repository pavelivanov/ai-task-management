import { Module } from '@nestjs/common';

import { AppConfigModule } from './config/app-config.module';
import { AuthModule } from './modules/auth/auth.module';
import { DailyPlansModule } from './modules/daily-plans/daily-plans.module';
import { FocusModule } from './modules/focus/focus.module';
import { HealthModule } from './modules/health/health.module';
import { InboxModule } from './modules/inbox/inbox.module';
import { InvalidationsModule } from './modules/invalidations/invalidations.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    AppConfigModule,
    AuthModule,
    DailyPlansModule,
    FocusModule,
    HealthModule,
    InboxModule,
    InvalidationsModule,
    ProjectsModule,
    TasksModule,
    UsersModule,
  ],
})
export class AppModule {}
