import type { INestApplication } from '@nestjs/common';

import { ApiExceptionFilter } from './common/http/api-exception.filter';
import { AppConfig } from './config/app-config.service';

export function configureApplication(app: INestApplication): void {
  const config = app.get(AppConfig);
  app.enableCors({
    credentials: true,
    origin: config.webOrigins,
  });
  app.enableShutdownHooks();
  app.useGlobalFilters(new ApiExceptionFilter());
}
