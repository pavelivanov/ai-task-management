import { z } from 'zod';

const projectNameSchema = z.string().trim().min(1).max(120);
const projectColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Expected a six-digit hex color.')
  .nullable();

export const createProjectSchema = z
  .object({
    name: projectNameSchema,
    color: projectColorSchema.optional(),
  })
  .strict();

export const updateProjectSchema = z
  .object({ name: projectNameSchema, color: projectColorSchema })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one editable project field is required.',
  });

const includeArchivedSchema = z.preprocess((value) => {
  if (value === undefined) return false;
  if (value === 'true' || value === true) return true;
  if (value === 'false' || value === false) return false;
  return value;
}, z.boolean());

export const listProjectsQuerySchema = z
  .object({
    cursor: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    includeArchived: includeArchivedSchema,
  })
  .strict();

export const projectSchema = z.object({
  id: z.uuid(),
  name: projectNameSchema,
  color: projectColorSchema,
  archivedAt: z.iso.datetime({ offset: true }).nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});

export const projectPageSchema = z.object({
  items: z.array(projectSchema),
  nextCursor: z.uuid().nullable(),
});

export const projectIdParamSchema = z.uuid();

export type CreateProject = z.output<typeof createProjectSchema>;
export type UpdateProject = z.output<typeof updateProjectSchema>;
export type ListProjectsQuery = z.output<typeof listProjectsQuerySchema>;
export type Project = z.infer<typeof projectSchema>;
export type ProjectPage = z.infer<typeof projectPageSchema>;
