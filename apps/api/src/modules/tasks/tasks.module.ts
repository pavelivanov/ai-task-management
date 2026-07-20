import { Module } from '@nestjs/common';

import { AppConfigModule } from '../../config/app-config.module';
import { DatabaseModule } from '../../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { TaskLifecycleService } from './task-lifecycle.service';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

@Module({
  imports: [AppConfigModule, AuthModule, DatabaseModule],
  controllers: [TasksController],
  providers: [TaskLifecycleService, TasksService],
  exports: [TaskLifecycleService, TasksService],
})
export class TasksModule {}
