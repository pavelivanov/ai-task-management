import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  type AuthenticatedUser,
  type NotificationPage,
  notificationIdParamSchema,
  type PushConfiguration,
  type PushSubscription,
  type PushSubscriptionInput,
  pushSubscriptionInputSchema,
  type UnsubscribePush,
  unsubscribePushSchema,
} from '@execution/contracts';

import { ZodValidationPipe } from '../../common/http/zod-validation.pipe';
import { CsrfOriginGuard } from '../auth/csrf-origin.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
@UseGuards(SessionAuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser): Promise<NotificationPage> {
    return this.notifications.list(user.id);
  }

  @Get('push/config')
  configuration(): PushConfiguration {
    return this.notifications.configuration();
  }

  @Post(':notificationId/read')
  @HttpCode(204)
  @UseGuards(CsrfOriginGuard)
  markRead(
    @CurrentUser() user: AuthenticatedUser,
    @Param('notificationId', new ZodValidationPipe(notificationIdParamSchema))
    notificationId: string,
  ): Promise<void> {
    return this.notifications.markRead(user.id, notificationId);
  }

  @Post('read-all')
  @HttpCode(204)
  @UseGuards(CsrfOriginGuard)
  markAllRead(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    return this.notifications.markAllRead(user.id);
  }

  @Post('push/subscriptions')
  @UseGuards(CsrfOriginGuard)
  subscribe(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(pushSubscriptionInputSchema))
    input: PushSubscriptionInput,
  ): Promise<PushSubscription> {
    return this.notifications.subscribe(user.id, input);
  }

  @Delete('push/subscriptions')
  @HttpCode(204)
  @UseGuards(CsrfOriginGuard)
  unsubscribe(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(unsubscribePushSchema)) input: UnsubscribePush,
  ): Promise<void> {
    return this.notifications.unsubscribe(user.id, input.endpoint);
  }
}
