import {
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';

import { StructuredLogger } from '../../common/observability/structured-logger.service';

import { AuthService } from './auth.service';

const cleanupIntervalMilliseconds = 24 * 60 * 60 * 1000;

@Injectable()
export class SessionCleanupScheduler
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly authService: AuthService,
    private readonly logger: StructuredLogger,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      void this.run().catch(() => {
        this.logger.error(
          'session.cleanup.failed',
          undefined,
          SessionCleanupScheduler.name,
        );
      });
    }, cleanupIntervalMilliseconds);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async run(): Promise<number> {
    return this.authService.cleanupExpiredSessions();
  }
}
