import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import type { RigConfig } from '../src/config.js';
import { exportPreview, previewNight } from '../src/export-preview.js';

const exec = promisify(execFile);
const script = fileURLToPath(new URL('../src/export-preview.ts', import.meta.url));
const tsconfig = fileURLToPath(new URL('../tsconfig.json', import.meta.url));
const loader = import.meta.resolve('tsx');
let dir: string;
let config: RigConfig;
let output: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rig-preview-'));
  const runsDir = join(dir, 'runs');
  mkdirSync(runsDir);
  writeFileSync(join(runsDir, `${previewNight}.jsonl`), JSON.stringify({
    at: '2026-10-28T23:00:00+01:00', job: 'sample-job', owner: null, status: 'ok',
  }));
  config = { adapter: 'shim', installed: '', beatEverySeconds: 60, runsDir };
  output = join(dir, 'preview', 'index.html');
  writeFileSync(join(dir, 'rig.json'), JSON.stringify(config));
  vi.stubEnv('LANE_ID', 'preview-test');
  vi.stubEnv('LANE_MARKER', '');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

function cli(args: string[] = []) {
  const env: NodeJS.ProcessEnv = { ...process.env, TSX_TSCONFIG_PATH: tsconfig };
  delete env.LANE_MARKER;
  return exec(process.execPath, [...args, '--import', loader, script], {
    cwd: dir, env, timeout: 5_000,
  });
}

describe('preview export', () => {
  it('fetches the digest over loopback, saves the exact self-contained page and closes the server', async () => {
    const marker = randomUUID();
    vi.stubEnv('LANE_MARKER', marker);
    const listen = vi.spyOn(Server.prototype, 'listen');
    const close = vi.spyOn(Server.prototype, 'close');
    const expected = await (await createApp(config).request(`/digest/${previewNight}`)).text();

    await exportPreview(output, config);

    const html = readFileSync(output, 'utf8');
    expect(html).toBe(expected);
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('<style>');
    expect(html).toContain('preview-test');
    expect(html).toContain(marker);
    expect(html).toContain('sample-job');
    expect(html).not.toMatch(/<(?:script|link)\b|(?:src|href)=/i);
    expect(readdirSync(join(dir, 'preview'))).toEqual(['index.html']);
    expect(listen).toHaveBeenCalledWith(0, '127.0.0.1');
    expect(close).toHaveBeenCalledOnce();
    expect(existsSync(join(dir, 'var', 'heartbeat.json'))).toBe(false);
  });

  it('does not replace an existing preview on HTTP failure and still closes the server', async () => {
    rmSync(join(config.runsDir, `${previewNight}.jsonl`));
    mkdirSync(join(dir, 'preview'));
    writeFileSync(output, 'previous preview');
    const close = vi.spyOn(Server.prototype, 'close');

    await expect(exportPreview(output, config)).rejects.toThrow('HTTP 404');

    expect(readFileSync(output, 'utf8')).toBe('previous preview');
    expect(close).toHaveBeenCalledOnce();
  });

  it('rejects non-HTML responses and closes the server', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', {
      headers: { 'content-type': 'application/json' },
    })));
    const close = vi.spyOn(Server.prototype, 'close');

    await expect(exportPreview(output, config)).rejects.toThrow('did not return HTML');

    expect(existsSync(output)).toBe(false);
    expect(close).toHaveBeenCalledOnce();
  });

  it('closes the server when writing the output fails', async () => {
    writeFileSync(join(dir, 'preview'), 'not a directory');
    const close = vi.spyOn(Server.prototype, 'close');

    await expect(exportPreview(output, config)).rejects.toThrow();

    expect(close).toHaveBeenCalledOnce();
  });

  it('bounds a stalled fetch with a ten-second deadline and closes the server', async () => {
    const timeout = AbortSignal.timeout.bind(AbortSignal);
    const deadline = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => timeout(20));
    vi.stubGlobal('fetch', (_input: unknown, init: RequestInit) => new Promise((_resolve, reject) => {
      const signal = init.signal!;
      signal.throwIfAborted();
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }));
    const close = vi.spyOn(Server.prototype, 'close');

    await expect(exportPreview(output, config)).rejects.toMatchObject({ name: 'TimeoutError' });

    expect(deadline).toHaveBeenCalledWith(10_000);
    expect(close).toHaveBeenCalledOnce();
    expect(existsSync(output)).toBe(false);
  });

  it('loads .env only with explicit Node opt-in, then overwrites cleanly without loading it', async () => {
    const marker = randomUUID();
    // This .env is a temporary fixture, never the repository's .env.
    writeFileSync(join(dir, '.env'), `LANE_MARKER=${marker}\n`);

    const marked = await cli(['--env-file=.env']);
    const defaultOutput = join(dir, 'var', 'preview', 'index.html');
    expect(readFileSync(defaultOutput, 'utf8')).toContain(marker);
    expect(marked.stdout + marked.stderr).not.toContain(marker);

    const clean = await cli();
    const html = readFileSync(defaultOutput, 'utf8');
    expect(html).toContain('no marker set');
    expect(html).not.toContain(marker);
    expect(clean.stdout + clean.stderr).not.toContain(marker);
    expect(readdirSync(join(dir, 'var'))).toEqual(['preview']);
    expect(readdirSync(join(dir, 'var', 'preview'))).toEqual(['index.html']);
  });

  it('exits with a nonzero status on failure, without leaving a listener or output', async () => {
    rmSync(join(config.runsDir, `${previewNight}.jsonl`));

    await expect(cli()).rejects.toMatchObject({
      code: 1, killed: false, stderr: expect.stringContaining('Preview export failed.'),
    });

    expect(existsSync(join(dir, 'var', 'preview', 'index.html'))).toBe(false);
  });
});
