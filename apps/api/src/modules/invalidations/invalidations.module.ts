import { Module } from '@nestjs/common';

import { AppConfigModule } from '../../config/app-config.module';
import { AuthModule } from '../auth/auth.module';
import { InvalidationStreamController } from './invalidation-stream.controller';
import { InvalidationStreamService } from './invalidation-stream.service';

@Module({
  imports: [AppConfigModule, AuthModule],
  controllers: [InvalidationStreamController],
  providers: [InvalidationStreamService],
  exports: [InvalidationStreamService],
})
export class InvalidationsModule {}
