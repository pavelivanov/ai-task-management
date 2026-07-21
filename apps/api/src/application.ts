import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';

import { ApiExceptionFilter } from './common/http/api-exception.filter';
import { AppConfig } from './config/app-config.service';

export function configureApplication(app: INestApplication): void {
  const config = app.get(AppConfig);
  const expressApp = app as NestExpressApplication;

  expressApp.set('trust proxy', config.trustProxyHops);
  expressApp.use(helmet());
  expressApp.useBodyParser('json', {
    limit: `${config.requestBodyLimitKb}kb`,
    strict: true,
  });
  expressApp.useBodyParser('urlencoded', {
    extended: false,
    limit: `${config.requestBodyLimitKb}kb`,
  });
  app.enableCors({
    credentials: true,
    origin: config.webOrigins,
  });
  app.enableShutdownHooks();
  app.useGlobalFilters(new ApiExceptionFilter());
}
