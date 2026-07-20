import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { configureApplication } from './application';
import { AppConfig } from './config/app-config.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  configureApplication(app);

  await app.listen(app.get(AppConfig).port, '0.0.0.0');
}

void bootstrap();
