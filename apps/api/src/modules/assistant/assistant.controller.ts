import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  type AssistantSuggestion,
  assistantSuggestionIdParamSchema,
  type AuthenticatedUser,
  type CreateAssistantSuggestion,
  createAssistantSuggestionSchema,
  type EditAssistantSuggestion,
  editAssistantSuggestionSchema,
  type RejectAssistantSuggestion,
  rejectAssistantSuggestionSchema,
} from '@execution/contracts';
import type { Response } from 'express';

import { ZodValidationPipe } from '../../common/http/zod-validation.pipe';
import { CsrfOriginGuard } from '../auth/csrf-origin.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { AssistantService } from './assistant.service';

@Controller('assistant/suggestions')
@UseGuards(SessionAuthGuard)
export class AssistantController {
  constructor(private readonly assistant: AssistantService) {}

  @Post()
  @UseGuards(CsrfOriginGuard)
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createAssistantSuggestionSchema))
    input: CreateAssistantSuggestion,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AssistantSuggestion> {
    const suggestion = await this.assistant.create(user.id, input);
    if (suggestion.status === 'queued') response.status(202);
    return suggestion;
  }

  @Get(':id')
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ZodValidationPipe(assistantSuggestionIdParamSchema))
    id: string,
  ): Promise<AssistantSuggestion> {
    return this.assistant.get(user.id, id);
  }

  @Post(':id/accept')
  @UseGuards(CsrfOriginGuard)
  accept(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ZodValidationPipe(assistantSuggestionIdParamSchema))
    id: string,
    @Body(new ZodValidationPipe(editAssistantSuggestionSchema))
    input: EditAssistantSuggestion,
  ): Promise<AssistantSuggestion> {
    return this.assistant.accept(user.id, id, input.output ? input : undefined);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @UseGuards(CsrfOriginGuard)
  reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ZodValidationPipe(assistantSuggestionIdParamSchema))
    id: string,
    @Body(new ZodValidationPipe(rejectAssistantSuggestionSchema))
    input: RejectAssistantSuggestion,
  ): Promise<AssistantSuggestion> {
    return this.assistant.reject(user.id, id, input);
  }
}
