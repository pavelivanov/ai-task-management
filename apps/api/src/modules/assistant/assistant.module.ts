import { Module } from '@nestjs/common';

import { AppConfigModule } from '../../config/app-config.module';
import { AppConfig } from '../../config/app-config.service';
import { DatabaseModule } from '../../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { DailyPlansModule } from '../daily-plans/daily-plans.module';
import { InvalidationsModule } from '../invalidations/invalidations.module';
import { ReviewsModule } from '../reviews/reviews.module';
import { TasksModule } from '../tasks/tasks.module';
import { AssistantContextService } from './assistant-context.service';
import { AssistantController } from './assistant.controller';
import { AssistantRateLimiter } from './assistant-rate-limiter';
import { AssistantSemanticValidator } from './assistant-semantic-validator';
import { AssistantService } from './assistant.service';
import { AssistantWorkerService } from './assistant-worker.service';
import { DisabledLlmProvider } from './disabled-llm.provider';
import { FakeLlmProvider } from './fake-llm.provider';
import { LLM_PROVIDER } from './llm-provider';
import { OpenAiLlmProvider } from './openai-llm.provider';

@Module({
  imports: [
    AppConfigModule,
    AuthModule,
    DatabaseModule,
    DailyPlansModule,
    InvalidationsModule,
    ReviewsModule,
    TasksModule,
  ],
  controllers: [AssistantController],
  providers: [
    AssistantContextService,
    AssistantRateLimiter,
    AssistantSemanticValidator,
    AssistantService,
    AssistantWorkerService,
    DisabledLlmProvider,
    FakeLlmProvider,
    OpenAiLlmProvider,
    {
      provide: LLM_PROVIDER,
      inject: [
        AppConfig,
        DisabledLlmProvider,
        FakeLlmProvider,
        OpenAiLlmProvider,
      ],
      useFactory: (
        config: AppConfig,
        disabled: DisabledLlmProvider,
        fake: FakeLlmProvider,
        openai: OpenAiLlmProvider,
      ) => {
        if (config.assistantProvider === 'fake') return fake;
        if (config.assistantProvider === 'openai') return openai;
        return disabled;
      },
    },
  ],
  exports: [AssistantService, AssistantWorkerService],
})
export class AssistantModule {}
