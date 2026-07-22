import { Global, Module } from '@nestjs/common';

import { AppConfigModule } from '../../config/app-config.module';
import { OperationalMetrics } from './operational-metrics.service';
import { StructuredLogger } from './structured-logger.service';

@Global()
@Module({
  imports: [AppConfigModule],
  providers: [OperationalMetrics, StructuredLogger],
  exports: [OperationalMetrics, StructuredLogger],
})
export class ObservabilityModule {}
