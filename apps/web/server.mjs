import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const distributionDirectory = resolve('dist');
const indexPath = resolve(distributionDirectory, 'index.html');
const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webmanifest', 'application/manifest+json'],
  ['.woff2', 'font/woff2'],
]);

function applySecurityHeaders(response) {
  response.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; base-uri 'self'; connect-src 'self' https: http://127.0.0.1:* http://localhost:*; form-action 'self'; frame-ancestors 'none'; img-src 'self' data: https:; manifest-src 'self'; object-src 'none'; script-src 'self'; style-src 'self'; worker-src 'self'",
  );
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
}

function cacheControl(path) {
  if (path.endsWith('/sw.js') || path === indexPath) {
    return 'no-cache, no-store, must-revalidate';
  }
  if (path.includes(`${sep}assets${sep}`)) {
    return 'public, max-age=31536000, immutable';
  }
  return 'public, max-age=3600';
}

async function regularFile(path) {
  try {
    const details = await stat(path);
    return details.isFile() ? details : null;
  } catch {
    return null;
  }
}

async function sendFile(request, response, path) {
  const details = await regularFile(path);
  if (!details) return false;

  response.statusCode = 200;
  response.setHeader('Cache-Control', cacheControl(path));
  response.setHeader('Content-Length', details.size);
  response.setHeader(
    'Content-Type',
    contentTypes.get(extname(path)) ?? 'application/octet-stream',
  );
  if (request.method === 'HEAD') {
    response.end();
    return true;
  }
  createReadStream(path)
    .once('error', () => {
      if (!response.headersSent) response.statusCode = 500;
      response.end();
    })
    .pipe(response);
  return true;
}

export function createWebServer() {
  return createServer(async (request, response) => {
    applySecurityHeaders(response);
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.statusCode = 405;
      response.setHeader('Allow', 'GET, HEAD');
      response.end();
      return;
    }
    if (request.url === '/health') {
      response.statusCode = 200;
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.end(JSON.stringify({ service: 'web', status: 'ok' }));
      return;
    }

    try {
      const pathname = decodeURIComponent(
        new URL(request.url ?? '/', 'http://localhost').pathname,
      );
      const requestedPath = resolve(
        distributionDirectory,
        `.${pathname === '/' ? '/index.html' : pathname}`,
      );
      if (
        requestedPath !== distributionDirectory &&
        !requestedPath.startsWith(`${distributionDirectory}${sep}`)
      ) {
        response.statusCode = 400;
        response.end();
        return;
      }
      if (await sendFile(request, response, requestedPath)) return;

      const acceptsHtml =
        request.headers.accept?.includes('text/html') ?? false;
      if (!extname(pathname) || acceptsHtml) {
        await sendFile(request, response, indexPath);
        return;
      }
      response.statusCode = 404;
      response.end();
    } catch {
      response.statusCode = 400;
      response.end();
    }
  });
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const port = Number.parseInt(process.env.WEB_PORT ?? '8080', 10);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('WEB_PORT must be an integer between 1 and 65535.');
  }

  const server = createWebServer();
  server.listen(port, '0.0.0.0');

  function shutdown() {
    server.close(() => process.exit(0));
  }

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
