import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CreateProject,
  ListProjectsQuery,
  Project,
  ProjectPage,
  UpdateProject,
} from '@execution/contracts';

import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { type Clock, CLOCK } from '../auth/clock';
import { toProjectContract } from './project-presenter';

function normalizeName(name: string): string {
  return name.trim().toLocaleLowerCase('en-US');
}

function isUniqueConflict(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2002'
  );
}

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async create(userId: string, input: CreateProject): Promise<Project> {
    try {
      const now = this.clock.now();
      return toProjectContract(
        await this.prisma.project.create({
          data: {
            userId,
            name: input.name,
            normalizedName: normalizeName(input.name),
            color: input.color ?? null,
            createdAt: now,
            updatedAt: now,
          },
        }),
      );
    } catch (error) {
      if (isUniqueConflict(error)) this.throwDuplicate();
      throw error;
    }
  }

  async list(userId: string, query: ListProjectsQuery): Promise<ProjectPage> {
    const where = {
      userId,
      ...(query.includeArchived ? {} : { archivedAt: null }),
    };
    if (query.cursor) {
      const cursor = await this.prisma.project.findFirst({
        where: { ...where, id: query.cursor },
        select: { id: true },
      });
      if (!cursor) this.throwInvalidCursor();
    }
    const projects = await this.prisma.project.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = projects.length > query.limit;
    const items = hasMore ? projects.slice(0, query.limit) : projects;
    return {
      items: items.map(toProjectContract),
      nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
    };
  }

  async update(
    userId: string,
    projectId: string,
    patch: UpdateProject,
  ): Promise<Project> {
    const current = await this.prisma.project.findFirst({
      where: { id: projectId, userId },
    });
    if (!current) this.throwNotFound();

    try {
      const data: Prisma.ProjectUpdateInput = {};
      if (patch.name !== undefined) {
        data.name = patch.name;
        data.normalizedName = normalizeName(patch.name);
      }
      if (patch.color !== undefined) data.color = patch.color;
      return toProjectContract(
        await this.prisma.project.update({
          where: { id: current.id },
          data,
        }),
      );
    } catch (error) {
      if (isUniqueConflict(error)) this.throwDuplicate();
      throw error;
    }
  }

  async archive(userId: string, projectId: string): Promise<Project> {
    const current = await this.prisma.project.findFirst({
      where: { id: projectId, userId },
    });
    if (!current) this.throwNotFound();
    if (current.archivedAt) return toProjectContract(current);
    return toProjectContract(
      await this.prisma.project.update({
        where: { id: current.id },
        data: { archivedAt: this.clock.now() },
      }),
    );
  }

  private throwNotFound(): never {
    throw new NotFoundException({
      code: 'PROJECT_NOT_FOUND',
      message: 'Project was not found.',
    });
  }

  private throwDuplicate(): never {
    throw new ConflictException({
      code: 'PROJECT_NAME_CONFLICT',
      message: 'An active or archived project already uses this name.',
    });
  }

  private throwInvalidCursor(): never {
    throw new BadRequestException({
      code: 'INVALID_CURSOR',
      message: 'Pagination cursor is invalid for this result set.',
    });
  }
}
