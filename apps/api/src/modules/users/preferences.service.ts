import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  type UpdateUserPreferences,
  type UserPreferences,
  userPreferencesSchema,
} from '@execution/contracts';

import { PrismaService } from '../../database/prisma.service';
import { type Clock, CLOCK } from '../auth/clock';

function formatLocalTime(value: Date): string {
  const hours = value.getUTCHours().toString().padStart(2, '0');
  const minutes = value.getUTCMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

function parseLocalTime(value: string): Date;
function parseLocalTime(value: null): null;
function parseLocalTime(value: string | null): Date | null {
  if (value === null) return null;
  const [hours, minutes] = value.split(':').map(Number);
  return new Date(Date.UTC(1970, 0, 1, hours ?? 0, minutes ?? 0));
}

interface StoredPreferences {
  workdayStart: Date;
  workdayEnd: Date;
  primaryTaskLimit: number;
  secondaryTaskLimit: number;
  capacityWarningPercent: number;
  protectedHoursEnabled: boolean;
  protectedHoursStart: Date | null;
  protectedHoursEnd: Date | null;
  notificationsEnabled: boolean;
  morningPlanningReminder: boolean;
  endOfDayReminder: boolean;
  aiInterruptionLevel: 'minimal' | 'balanced' | 'proactive';
  user: { timezone: string };
}

function toContract(preferences: StoredPreferences): UserPreferences {
  return {
    timezone: preferences.user.timezone,
    workdayStart: formatLocalTime(preferences.workdayStart),
    workdayEnd: formatLocalTime(preferences.workdayEnd),
    primaryTaskLimit: preferences.primaryTaskLimit,
    secondaryTaskLimit: preferences.secondaryTaskLimit,
    capacityWarningPercent: preferences.capacityWarningPercent,
    protectedHoursEnabled: preferences.protectedHoursEnabled,
    protectedHoursStart: preferences.protectedHoursStart
      ? formatLocalTime(preferences.protectedHoursStart)
      : null,
    protectedHoursEnd: preferences.protectedHoursEnd
      ? formatLocalTime(preferences.protectedHoursEnd)
      : null,
    notificationsEnabled: preferences.notificationsEnabled,
    morningPlanningReminder: preferences.morningPlanningReminder,
    endOfDayReminder: preferences.endOfDayReminder,
    aiInterruptionLevel: preferences.aiInterruptionLevel,
  };
}

@Injectable()
export class PreferencesService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async getForUser(userId: string): Promise<UserPreferences> {
    const preferences = await this.prisma.userPreferences.findUnique({
      where: { userId },
      include: { user: { select: { timezone: true } } },
    });
    if (!preferences) {
      throw new NotFoundException({
        code: 'PREFERENCES_NOT_FOUND',
        message: 'User preferences were not found.',
      });
    }
    return toContract(preferences);
  }

  async updateForUser(
    userId: string,
    patch: UpdateUserPreferences,
  ): Promise<UserPreferences> {
    const current = await this.getForUser(userId);
    const parsed = userPreferencesSchema.safeParse({ ...current, ...patch });
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'INVALID_PREFERENCES',
        message: 'Preference values are inconsistent.',
        issues: parsed.error.issues.map(
          (issue) => `${issue.path.join('.')}: ${issue.message}`,
        ),
      });
    }
    const next = parsed.data;

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { timezone: next.timezone },
      }),
      this.prisma.userPreferences.update({
        where: { userId },
        data: {
          workdayStart: parseLocalTime(next.workdayStart),
          workdayEnd: parseLocalTime(next.workdayEnd),
          primaryTaskLimit: next.primaryTaskLimit,
          secondaryTaskLimit: next.secondaryTaskLimit,
          capacityWarningPercent: next.capacityWarningPercent,
          protectedHoursEnabled: next.protectedHoursEnabled,
          protectedHoursStart:
            next.protectedHoursStart === null
              ? null
              : parseLocalTime(next.protectedHoursStart),
          protectedHoursEnd:
            next.protectedHoursEnd === null
              ? null
              : parseLocalTime(next.protectedHoursEnd),
          notificationsEnabled: next.notificationsEnabled,
          morningPlanningReminder: next.morningPlanningReminder,
          endOfDayReminder: next.endOfDayReminder,
          aiInterruptionLevel: next.aiInterruptionLevel,
        },
      }),
      this.prisma.notification.deleteMany({
        where: {
          userId,
          scheduledAt: { gt: this.clock.now() },
          deliveryStatus: { in: ['pending', 'retry'] },
        },
      }),
    ]);

    return this.getForUser(userId);
  }
}
