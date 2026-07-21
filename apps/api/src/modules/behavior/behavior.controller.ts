import { Controller, Get, UseGuards } from '@nestjs/common';
import type {
  AssistantTriggerPage,
  AuthenticatedUser,
  WaitingSuggestions,
} from '@execution/contracts';

import { CurrentUser } from '../auth/current-user.decorator';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { BehaviorService } from './behavior.service';

@Controller('behavior')
@UseGuards(SessionAuthGuard)
export class BehaviorController {
  constructor(private readonly behavior: BehaviorService) {}

  @Get('triggers')
  listTriggers(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AssistantTriggerPage> {
    return this.behavior.listTriggers(user.id);
  }

  @Get('waiting-suggestions')
  waitingSuggestions(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<WaitingSuggestions> {
    return this.behavior.waitingSuggestions(user.id);
  }
}
