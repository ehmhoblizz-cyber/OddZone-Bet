import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';

const root = resolve(process.cwd());
const host = '127.0.0.1';
const port = Number(process.env.PORT || 8000);
const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

const server = createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end('Method not allowed');
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, `http://${host}`).pathname);
  } catch {
    response.writeHead(400).end('Invalid URL');
    return;
  }
  if (pathname.includes('\\') || pathname.includes('\0')) {
    response.writeHead(400).end('Invalid path');
    return;
  }

  const filePath = resolve(root, ...pathname.split('/').filter(Boolean));
  if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
    response.writeHead(403).end('Forbidden');
    return;
  }

  try {
    let file = await stat(filePath);
    let target = filePath;
    if (file.isDirectory()) {
      target = resolve(filePath, 'index.html');
      file = await stat(target);
    }
    if (!file.isFile()) {
      response.writeHead(404).end('Not found');
      return;
    }

    response.writeHead(200, {
      'Content-Length': file.size,
      'Content-Type': contentTypes[extname(target).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    if (request.method === 'HEAD') {
      response.end();
    } else {
      createReadStream(target).pipe(response);
    }
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
      response.writeHead(404).end('Not found');
      return;
    }
    console.error(`Could not serve ${pathname}:`, error);
    if (!response.headersSent) response.writeHead(500);
    response.end('Internal server error');
  }
});

server.listen(port, host, () => {
  console.log(`OddZone is serving at http://${host}:${port}/`);
  console.log('Press Ctrl+C to stop the server.');
});
