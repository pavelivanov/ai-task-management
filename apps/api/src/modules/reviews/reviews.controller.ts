import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  type AuthenticatedUser,
  type DailyReview,
  dailyReviewDateParamSchema,
  type UpdateDailyReview,
  updateDailyReviewSchema,
} from '@execution/contracts';

import { ZodValidationPipe } from '../../common/http/zod-validation.pipe';
import { CsrfOriginGuard } from '../auth/csrf-origin.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { ReviewsService } from './reviews.service';

@Controller('reviews/daily')
@UseGuards(SessionAuthGuard)
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get(':date')
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('date', new ZodValidationPipe(dailyReviewDateParamSchema))
    date: string,
  ): Promise<DailyReview> {
    return this.reviews.get(user.id, date);
  }

  @Post(':date/generate')
  @UseGuards(CsrfOriginGuard)
  generate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('date', new ZodValidationPipe(dailyReviewDateParamSchema))
    date: string,
  ): Promise<DailyReview> {
    return this.reviews.generate(user.id, date);
  }

  @Patch(':date')
  @UseGuards(CsrfOriginGuard)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('date', new ZodValidationPipe(dailyReviewDateParamSchema))
    date: string,
    @Body(new ZodValidationPipe(updateDailyReviewSchema))
    input: UpdateDailyReview,
  ): Promise<DailyReview> {
    return this.reviews.update(user.id, date, input);
  }
}
