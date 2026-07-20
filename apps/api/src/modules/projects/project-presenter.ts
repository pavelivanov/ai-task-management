import type { Project as ProjectContract } from '@execution/contracts';

import type { Project as StoredProject } from '../../generated/prisma/client';

export function toProjectContract(project: StoredProject): ProjectContract {
  return {
    id: project.id,
    name: project.name,
    color: project.color,
    archivedAt: project.archivedAt?.toISOString() ?? null,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };
}
