import { getRequestListener } from '@hono/node-server';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createApp } from './app.js';
import { loadConfig, type RigConfig } from './config.js';

export const previewNight = '2026-10-28';

// Do not load .env here. A clean export must use only the caller's environment.
export async function exportPreview(
  output = 'var/preview/index.html',
  config: RigConfig = loadConfig(),
) {
  const server = createServer(getRequestListener(createApp(config).fetch));
  const signal = AbortSignal.timeout(10_000);

  try {
    const listening = once(server, 'listening', { signal });
    server.listen(0, '127.0.0.1');
    await listening;
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No preview listener');

    const response = await fetch(`http://127.0.0.1:${address.port}/digest/${previewNight}`, {
      signal,
      redirect: 'error',
    });
    if (!response.ok) throw new Error(`Digest export failed (HTTP ${response.status})`);
    if (!response.headers.get('content-type')?.startsWith('text/html')) {
      throw new Error('Digest export did not return HTML');
    }
    const html = await response.text();
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, html, { encoding: 'utf8', signal });
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length > 3) throw new Error('Expected at most one output path');
    await exportPreview(process.argv[2]);
    console.log('Preview HTML exported.');
  } catch {
    // Do not log response content or environment values: they can contain the marker.
    console.error('Preview export failed. Check the run file, output path, and local listener.');
    process.exitCode = 1;
  }
}
