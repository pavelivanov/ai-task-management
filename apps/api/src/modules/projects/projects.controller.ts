import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  type AuthenticatedUser,
  type CreateProject,
  createProjectSchema,
  type ListProjectsQuery,
  listProjectsQuerySchema,
  type Project,
  projectIdParamSchema,
  type ProjectPage,
  type UpdateProject,
  updateProjectSchema,
} from '@execution/contracts';

import { ZodValidationPipe } from '../../common/http/zod-validation.pipe';
import { CsrfOriginGuard } from '../auth/csrf-origin.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { ProjectsService } from './projects.service';

@Controller('projects')
@UseGuards(SessionAuthGuard)
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Post()
  @UseGuards(CsrfOriginGuard)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createProjectSchema)) input: CreateProject,
  ): Promise<Project> {
    return this.projects.create(user.id, input);
  }

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(listProjectsQuerySchema))
    query: ListProjectsQuery,
  ): Promise<ProjectPage> {
    return this.projects.list(user.id, query);
  }

  @Patch(':id')
  @UseGuards(CsrfOriginGuard)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ZodValidationPipe(projectIdParamSchema)) id: string,
    @Body(new ZodValidationPipe(updateProjectSchema)) patch: UpdateProject,
  ): Promise<Project> {
    return this.projects.update(user.id, id, patch);
  }

  @Post(':id/archive')
  @UseGuards(CsrfOriginGuard)
  archive(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ZodValidationPipe(projectIdParamSchema)) id: string,
  ): Promise<Project> {
    return this.projects.archive(user.id, id);
  }
}
