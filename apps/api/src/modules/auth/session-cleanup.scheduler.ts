import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';

import { AuthService } from './auth.service';

const cleanupIntervalMilliseconds = 24 * 60 * 60 * 1000;

@Injectable()
export class SessionCleanupScheduler
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(SessionCleanupScheduler.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly authService: AuthService) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      void this.run().catch(() => {
        this.logger.error('Expired-session cleanup failed.');
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
