import { Module } from '@nestjs/common';

import { AppConfigModule } from '../../config/app-config.module';
import { AuthModule } from '../auth/auth.module';
import { TasksModule } from '../tasks/tasks.module';
import { InboxController } from './inbox.controller';
import { InboxService } from './inbox.service';

@Module({
  imports: [AppConfigModule, AuthModule, TasksModule],
  controllers: [InboxController],
  providers: [InboxService],
})
export class InboxModule {}
