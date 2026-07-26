import type { AppConfig } from '../../config/app-config.service';
import type { PrismaService } from '../../database/prisma.service';
import type { AuthService } from '../auth/auth.service';
import type { Clock } from '../auth/clock';
import type { InvalidationStreamService } from '../invalidations/invalidation-stream.service';
import { DataRetentionService } from './data-retention.service';

function suggestion(index: number) {
  return {
    id: `suggestion-${String(index)}`,
    userId: 'user-1',
    version: 3,
  };
}

function createHarness() {
  const prisma = {
    aiSuggestion: {
      findMany: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    conversationMessage: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    conversation: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    notification: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    pushSubscription: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };
  const auth = {
    cleanupExpiredSessions: jest.fn().mockResolvedValue(0),
  };
  const invalidations = {
    publish: jest.fn(),
  };
  const clock = {
    now: jest.fn().mockReturnValue(new Date('2026-07-26T12:00:00.000Z')),
  };
  const config = {
    assistantRetentionDays: 30,
    notificationRetentionDays: 90,
    revokedPushRetentionDays: 30,
    retentionSweepIntervalMs: 3_600_000,
  };
  const service = new DataRetentionService(
    prisma as unknown as PrismaService,
    auth as unknown as AuthService,
    config as AppConfig,
    invalidations as unknown as InvalidationStreamService,
    clock as Clock,
  );
  return { auth, clock, invalidations, prisma, service };
}

describe('DataRetentionService', () => {
  it('drains suggestion expiry batches until the final partial batch', async () => {
    const { invalidations, prisma, service } = createHarness();
    prisma.aiSuggestion.findMany
      .mockResolvedValueOnce(
        Array.from({ length: 100 }, (_, index) => suggestion(index)),
      )
      .mockResolvedValueOnce(
        Array.from({ length: 25 }, (_, index) => suggestion(index + 100)),
      );

    await expect(service.runOnce()).resolves.toMatchObject({
      expiredSuggestions: 125,
    });
    expect(prisma.aiSuggestion.findMany).toHaveBeenCalledTimes(2);
    expect(prisma.aiSuggestion.updateMany).toHaveBeenCalledTimes(125);
    expect(invalidations.publish).toHaveBeenCalledTimes(125);
  });

  it('stops after the bounded 100-batch ceiling', async () => {
    const { prisma, service } = createHarness();
    prisma.aiSuggestion.findMany.mockResolvedValue(
      Array.from({ length: 100 }, (_, index) => suggestion(index)),
    );
    prisma.aiSuggestion.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.runOnce()).resolves.toMatchObject({
      expiredSuggestions: 0,
    });
    expect(prisma.aiSuggestion.findMany).toHaveBeenCalledTimes(100);
    expect(prisma.aiSuggestion.updateMany).toHaveBeenCalledTimes(10_000);
  });
});
