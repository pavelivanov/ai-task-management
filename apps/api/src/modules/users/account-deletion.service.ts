import { BadRequestException, Injectable } from '@nestjs/common';
import type { DeleteAccount } from '@execution/contracts';

import { AppConfig } from '../../config/app-config.service';
import { PrismaService } from '../../database/prisma.service';
import { AuthService } from '../auth/auth.service';
import { InvalidationStreamService } from '../invalidations/invalidation-stream.service';

@Injectable()
export class AccountDeletionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly config: AppConfig,
    private readonly invalidations: InvalidationStreamService,
  ) {}

  async deleteAccount(
    userId: string,
    sessionToken: string,
    input: DeleteAccount,
  ): Promise<void> {
    await this.auth.assertRecentlyAuthenticated(
      userId,
      sessionToken,
      this.config.accountDeletionReauthMinutes,
    );

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    if (
      !user ||
      user.email.toLowerCase() !== input.confirmationEmail.trim().toLowerCase()
    ) {
      throw new BadRequestException({
        code: 'ACCOUNT_CONFIRMATION_MISMATCH',
        message: 'The confirmation email does not match the signed-in account.',
      });
    }

    const deleted = await this.prisma.user.deleteMany({
      where: { id: userId },
    });
    if (deleted.count !== 1) {
      throw new BadRequestException({
        code: 'ACCOUNT_DELETE_FAILED',
        message: 'The account could not be deleted.',
      });
    }
    this.invalidations.closeUser(userId);
  }
}
