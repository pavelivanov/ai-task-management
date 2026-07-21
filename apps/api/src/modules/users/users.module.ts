import { Module } from '@nestjs/common';

import { AppConfigModule } from '../../config/app-config.module';
import { DatabaseModule } from '../../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { InvalidationsModule } from '../invalidations/invalidations.module';
import { AccountDeletionService } from './account-deletion.service';
import { AccountController } from './account.controller';
import { PreferencesController } from './preferences.controller';
import { PreferencesService } from './preferences.service';

@Module({
  imports: [AppConfigModule, AuthModule, DatabaseModule, InvalidationsModule],
  controllers: [AccountController, PreferencesController],
  providers: [AccountDeletionService, PreferencesService],
})
export class UsersModule {}
