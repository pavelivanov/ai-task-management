import { Module } from '@nestjs/common';

import { AppConfigModule } from '../../config/app-config.module';
import { DatabaseModule } from '../../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { InvalidationsModule } from '../invalidations/invalidations.module';
import { DataRetentionService } from './data-retention.service';

@Module({
  imports: [AppConfigModule, AuthModule, DatabaseModule, InvalidationsModule],
  providers: [DataRetentionService],
  exports: [DataRetentionService],
})
export class PrivacyModule {}
