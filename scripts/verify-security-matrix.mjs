import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const matrixPath = path.join(root, 'docs/security/control-matrix.md');
const matrix = readFileSync(matrixPath, 'utf8');
const controllerFiles = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard'],
  {
    cwd: root,
    encoding: 'utf8',
  },
)
  .split(/\r?\n/)
  .filter(
    (file) =>
      file.startsWith('apps/api/src/modules/') &&
      file.endsWith('.controller.ts'),
  );

function normalizedRoute(prefix, suffix) {
  const joined = [prefix, suffix].filter(Boolean).join('/');
  return `/${joined}`.replaceAll(/\/{2,}/g, '/');
}

const sourceRoutes = new Set();
for (const file of controllerFiles) {
  const source = readFileSync(path.join(root, file), 'utf8');
  const controller = source.match(/@Controller\((?:'([^']*)')?\)/);
  const prefix = controller?.[1] ?? '';
  for (const match of source.matchAll(
    /@(Get|Post|Patch|Put|Delete)\((?:'([^']*)')?\)/g,
  )) {
    sourceRoutes.add(
      `${match[1].toUpperCase()} ${normalizedRoute(prefix, match[2] ?? '')}`,
    );
  }
}

const schema = readFileSync(path.join(root, 'prisma/schema.prisma'), 'utf8');
const sourceModels = new Set(
  [...schema.matchAll(/^model\s+(\w+)\s+\{/gm)].map((match) => match[1]),
);
const documentedRoutes = new Set(
  [...matrix.matchAll(/<!-- route: ([A-Z]+ \/[^ ]*) -->/g)].map(
    (match) => match[1],
  ),
);
const documentedModels = new Set(
  [...matrix.matchAll(/<!-- table: (\w+) -->/g)].map((match) => match[1]),
);

const missingRoutes = [...sourceRoutes].filter(
  (route) => !documentedRoutes.has(route),
);
const staleRoutes = [...documentedRoutes].filter(
  (route) => !sourceRoutes.has(route),
);
const missingModels = [...sourceModels].filter(
  (model) => !documentedModels.has(model),
);
const staleModels = [...documentedModels].filter(
  (model) => !sourceModels.has(model),
);

if (
  missingRoutes.length ||
  staleRoutes.length ||
  missingModels.length ||
  staleModels.length
) {
  for (const [label, values] of [
    ['Missing routes', missingRoutes],
    ['Stale routes', staleRoutes],
    ['Missing tables', missingModels],
    ['Stale tables', staleModels],
  ]) {
    if (values.length) console.error(`${label}: ${values.sort().join(', ')}`);
  }
  process.exitCode = 1;
} else {
  console.log(
    `Security matrix covers ${sourceRoutes.size} routes and ${sourceModels.size} tables.`,
  );
}
