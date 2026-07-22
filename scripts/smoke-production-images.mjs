import { execFileSync } from 'node:child_process';

const apiPort = Number.parseInt(process.env.SMOKE_API_PORT ?? '3300', 10);
const webPort = Number.parseInt(process.env.SMOKE_WEB_PORT ?? '5180', 10);
for (const [name, value] of [
  ['SMOKE_API_PORT', apiPort],
  ['SMOKE_WEB_PORT', webPort],
]) {
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`${name} must be an integer between 1 and 65535.`);
  }
}
const apiUrl = `http://127.0.0.1:${apiPort}`;
const webUrl = `http://127.0.0.1:${webPort}`;
const project = `execution-assistant-smoke-${process.pid}`;
const composeArguments = [
  'compose',
  '--project-name',
  project,
  '-f',
  'compose.production-smoke.yaml',
];

function compose(...arguments_) {
  execFileSync('docker', [...composeArguments, ...arguments_], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      SMOKE_API_PORT: String(apiPort),
      SMOKE_WEB_PORT: String(webPort),
    },
    stdio: 'inherit',
  });
}

async function expectResponse(url, options, expectedStatus) {
  const response = await fetch(url, options);
  if (response.status !== expectedStatus) {
    throw new Error(
      `${options?.method ?? 'GET'} ${url} returned ${response.status}; expected ${expectedStatus}.`,
    );
  }
  return response;
}

async function jsonCommand(path, cookie, body) {
  const response = await expectResponse(
    `${apiUrl}${path}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
        Origin: webUrl,
      },
      body: JSON.stringify(body),
    },
    201,
  );
  return response.json();
}

function assertNonRoot(service) {
  const uid = execFileSync(
    'docker',
    [...composeArguments, 'exec', '-T', service, 'id', '-u'],
    { encoding: 'utf8' },
  ).trim();
  if (uid === '0') throw new Error(`${service} is running as root.`);
}

async function smoke() {
  compose('up', '--build', '--detach', '--wait', '--wait-timeout', '180');
  assertNonRoot('api');
  assertNonRoot('web');

  await expectResponse(`${apiUrl}/health`, undefined, 200);
  await expectResponse(`${apiUrl}/health/ready`, undefined, 200);
  const webHealth = await expectResponse(`${webUrl}/health`, undefined, 200);
  const webHealthBody = await webHealth.json();
  if (webHealthBody.service !== 'web' || webHealthBody.status !== 'ok') {
    throw new Error('The web health response is invalid.');
  }
  const spa = await expectResponse(
    `${webUrl}/focus`,
    { headers: { Accept: 'text/html' } },
    200,
  );
  if (!(await spa.text()).includes('id="root"')) {
    throw new Error('The web container did not serve the SPA fallback.');
  }
  const serviceWorker = await expectResponse(`${webUrl}/sw.js`, undefined, 200);
  if (!serviceWorker.headers.get('cache-control')?.includes('no-cache')) {
    throw new Error(
      'The service worker must be served without a durable cache.',
    );
  }

  const login = await expectResponse(
    `${apiUrl}/auth/e2e/login`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: webUrl },
      body: JSON.stringify({
        email: 'production-smoke@example.test',
        displayName: 'Production Smoke',
      }),
    },
    201,
  );
  const setCookie = login.headers.getSetCookie()[0];
  const cookie = setCookie?.split(';', 1)[0];
  if (!cookie)
    throw new Error('The smoke login did not issue a session cookie.');

  const task = await jsonCommand('/inbox/capture', cookie, {
    title: 'Verify production artifact loop',
    category: 'work',
    estimateMinutes: 15,
  });
  await jsonCommand(`/inbox/${task.id}/process`, cookie, {
    action: 'schedule',
    role: 'primary',
    plannedDurationMinutes: 15,
  });
  const focus = await jsonCommand('/focus/start', cookie, {
    taskId: task.id,
    initialIntent: 'Exercise the production-built API',
  });
  await jsonCommand(`/focus/${focus.id}/pause`, cookie, {});
  await jsonCommand(`/focus/${focus.id}/resume`, cookie, {});
  await jsonCommand(`/focus/${focus.id}/complete`, cookie, {
    outcome: 'Production artifact loop completed',
  });
  const closedPlan = await jsonCommand('/daily-plans/today/close', cookie, {});
  if (closedPlan.status !== 'closed') {
    throw new Error('The deterministic smoke plan did not close.');
  }
  await expectResponse(
    `${apiUrl}/reviews/daily/${closedPlan.date}`,
    { headers: { Cookie: cookie } },
    200,
  );
}

let failure = null;
try {
  await smoke();
} catch (error) {
  failure = error;
}
try {
  compose('down', '--volumes', '--remove-orphans');
} catch (error) {
  console.error(`Failed to clean up isolated Compose project ${project}.`);
  failure ??= error;
}
if (failure) throw failure;
console.log('Production image smoke passed.');
