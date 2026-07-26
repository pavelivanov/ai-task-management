import { once } from 'node:events';

import { afterEach, describe, expect, it } from 'vitest';

import { createWebServer } from './server.mjs';

let server;

afterEach(async () => {
  if (!server?.listening) return;
  server.close();
  await once(server, 'close');
});

describe('production web server', () => {
  it('allows only GET and HEAD for the health endpoint', async () => {
    server = createWebServer();
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected the web server to bind a TCP port.');
    }
    const healthUrl = `http://127.0.0.1:${String(address.port)}/health`;

    const getResponse = await fetch(healthUrl);
    expect(getResponse.status).toBe(200);
    await expect(getResponse.json()).resolves.toEqual({
      service: 'web',
      status: 'ok',
    });

    const postResponse = await fetch(healthUrl, { method: 'POST' });
    expect(postResponse.status).toBe(405);
    expect(postResponse.headers.get('allow')).toBe('GET, HEAD');
  });
});
