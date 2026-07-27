import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  type AddDailyPlanItem,
  addDailyPlanItemSchema,
  type AuthenticatedUser,
  type CloseDailyPlan,
  closeDailyPlanSchema,
  type CreateTodayPlan,
  createTodayPlanSchema,
  type DailyPlan,
  dailyPlanItemIdParamSchema,
  type RemoveDailyPlanItemQuery,
  removeDailyPlanItemQuerySchema,
  type ResolveCarryover,
  resolveCarryoverSchema,
  taskIdParamSchema,
  type UpdateDailyPlanItem,
  updateDailyPlanItemSchema,
  type UpdateTodayPlan,
  updateTodayPlanSchema,
} from '@execution/contracts';

import { ZodValidationPipe } from '../../common/http/zod-validation.pipe';
import { CsrfOriginGuard } from '../auth/csrf-origin.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { DailyPlansService } from './daily-plans.service';

@Controller('daily-plans/today')
@UseGuards(SessionAuthGuard)
export class DailyPlansController {
  constructor(private readonly dailyPlans: DailyPlansService) {}

  @Get()
  getToday(@CurrentUser() user: AuthenticatedUser): Promise<DailyPlan> {
    return this.dailyPlans.getToday(user.id);
  }

  @Post()
  @UseGuards(CsrfOriginGuard)
  createToday(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createTodayPlanSchema)) input: CreateTodayPlan,
  ): Promise<DailyPlan> {
    return this.dailyPlans.createToday(user.id, input);
  }

  @Patch()
  @UseGuards(CsrfOriginGuard)
  updateToday(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(updateTodayPlanSchema)) input: UpdateTodayPlan,
  ): Promise<DailyPlan> {
    return this.dailyPlans.updateToday(user.id, input);
  }

  @Post('items')
  @UseGuards(CsrfOriginGuard)
  addItem(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(addDailyPlanItemSchema))
    input: AddDailyPlanItem,
  ): Promise<DailyPlan> {
    return this.dailyPlans.addTodayItem(user.id, input);
  }

  @Patch('items/:itemId')
  @UseGuards(CsrfOriginGuard)
  updateItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('itemId', new ZodValidationPipe(dailyPlanItemIdParamSchema))
    itemId: string,
    @Body(new ZodValidationPipe(updateDailyPlanItemSchema))
    input: UpdateDailyPlanItem,
  ): Promise<DailyPlan> {
    return this.dailyPlans.updateTodayItem(user.id, itemId, input);
  }

  @Delete('items/:itemId')
  @UseGuards(CsrfOriginGuard)
  removeItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('itemId', new ZodValidationPipe(dailyPlanItemIdParamSchema))
    itemId: string,
    @Query(new ZodValidationPipe(removeDailyPlanItemQuerySchema))
    query: RemoveDailyPlanItemQuery,
  ): Promise<DailyPlan> {
    return this.dailyPlans.removeTodayItem(
      user.id,
      itemId,
      query.expectedPlanVersion,
    );
  }

  @Post('close')
  @UseGuards(CsrfOriginGuard)
  closeToday(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(closeDailyPlanSchema)) input: CloseDailyPlan,
  ): Promise<DailyPlan> {
    return this.dailyPlans.closeToday(user.id, input);
  }

  @Post('carryovers/:taskId/resolve')
  @UseGuards(CsrfOriginGuard)
  resolveCarryover(
    @CurrentUser() user: AuthenticatedUser,
    @Param('taskId', new ZodValidationPipe(taskIdParamSchema)) taskId: string,
    @Body(new ZodValidationPipe(resolveCarryoverSchema))
    input: ResolveCarryover,
  ): Promise<DailyPlan> {
    return this.dailyPlans.resolveTodayCarryover(user.id, taskId, input);
  }
}
