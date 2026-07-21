import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const trackedFiles = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  {
    cwd: root,
    encoding: 'utf8',
  },
)
  .split('\0')
  .filter(Boolean);

const tokenPatterns = [
  {
    name: 'private key material',
    expression: new RegExp(['BEGIN', '[ A-Z]+', 'PRIVATE KEY'].join('')),
  },
  {
    name: 'OpenAI API key',
    expression: new RegExp(['s', 'k-', '[A-Za-z0-9_-]{20,}'].join('')),
  },
  {
    name: 'GitHub token',
    expression: new RegExp(['gh', '[pousr]_', '[A-Za-z0-9]{20,}'].join('')),
  },
  {
    name: 'Google OAuth client secret',
    expression: new RegExp(['GOC', 'SPX-', '[A-Za-z0-9_-]{20,}'].join('')),
  },
  {
    name: 'AWS access key',
    expression: new RegExp(['AK', 'IA', '[A-Z0-9]{16}'].join('')),
  },
  {
    name: 'Slack token',
    expression: new RegExp(['xox', '[abprs]-', '[A-Za-z0-9-]{20,}'].join('')),
  },
];

const forbiddenFiles = [
  /(^|\/)\.env($|\.)/,
  /\.(?:key|pem|p12|pfx)$/i,
  /(^|\/)credentials\.json$/i,
];
const allowedEnvironmentFiles = new Set(['.env.example']);
const findings = [];

for (const file of trackedFiles) {
  const normalized = file.replaceAll('\\', '/');
  if (
    !allowedEnvironmentFiles.has(normalized) &&
    forbiddenFiles.some((expression) => expression.test(normalized))
  ) {
    findings.push({ file, line: 1, rule: 'forbidden credential file' });
    continue;
  }

  let content;
  try {
    content = readFileSync(path.join(root, file), 'utf8');
  } catch {
    continue;
  }
  const lines = content.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    for (const pattern of tokenPatterns) {
      if (pattern.expression.test(line)) {
        findings.push({ file, line: index + 1, rule: pattern.name });
      }
    }
  }
}

if (findings.length > 0) {
  console.error('Secret scan failed:');
  for (const finding of findings) {
    console.error(`- ${finding.file}:${finding.line} (${finding.rule})`);
  }
  process.exitCode = 1;
} else {
  console.log(
    `Secret scan passed for ${trackedFiles.length} tracked or untracked files.`,
  );
}
