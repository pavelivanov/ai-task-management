import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';

const DEFAULT_WEB_ORIGIN = 'http://localhost:5173';

export function parseAllowedOrigins(value: string | undefined): string[] {
  const origins = value
    ?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  return origins?.length ? origins : [DEFAULT_WEB_ORIGIN];
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    credentials: true,
    origin: parseAllowedOrigins(process.env.WEB_ORIGINS),
  });

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
}

void bootstrap();
