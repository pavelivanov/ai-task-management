import { Module } from '@nestjs/common';

import { AppConfigModule } from '../../config/app-config.module';
import { DatabaseModule } from '../../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { PreferencesController } from './preferences.controller';
import { PreferencesService } from './preferences.service';

@Module({
  imports: [AppConfigModule, AuthModule, DatabaseModule],
  controllers: [PreferencesController],
  providers: [PreferencesService],
})
export class UsersModule {}
