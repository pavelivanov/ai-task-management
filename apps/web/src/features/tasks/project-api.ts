import { projectPageSchema, type ProjectPage } from '@execution/contracts';

import { apiRequest } from '../../lib/api-client';

export function listProjects(): Promise<ProjectPage> {
  return apiRequest(
    '/projects?limit=100&includeArchived=false',
    projectPageSchema,
  );
}
