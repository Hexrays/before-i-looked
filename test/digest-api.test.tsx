import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { RigConfig } from '../src/config.js';

const night = '2026-10-28';
const config: RigConfig = {
  adapter: 'shim',
  installed: '2026-10-29T14:06:00+01:00',
  beatEverySeconds: 60,
  runsDir: '',
};
let runsDir: string;
beforeEach(() => { runsDir = mkdtempSync(join(tmpdir(), 'rig-routes-')); });
afterEach(() => { rmSync(runsDir, { recursive: true, force: true }); });

function writeNight(source: string, name = night) {
  writeFileSync(join(runsDir, `${name}.jsonl`), source);
}
function app() {
  return createApp({ ...config, runsDir });
}
const event = (job: string, status: 'ok' | 'retry' | 'fail', at: string, owner: string | null, error?: string) =>
  JSON.stringify({ at, job, status, owner, ...(error === undefined ? {} : { error }) });

describe('digest routes', () => {
  it('serves sorted, equivalent HTML and JSON with offsets, escaped values, null owners, and warnings', async () => {
    writeNight([
      event('z-job', 'retry', '2026-10-28T23:00:00+05:30', null, '<script>alert("x")</script>'),
      event('a&<job>', 'fail', '2026-10-28T23:01:00-04:30', '<owner>', 'failed & <unsafe>'),
      event('z-job', 'retry', '2026-10-29T00:00:00+05:30', 'updated', 'retry'),
      event('z-job', 'retry', '2026-10-29T01:00:00+05:30', 'updated'),
      event('z-job', 'ok', '2026-10-29T02:00:00+05:30', 'updated'),
      event('recovered', 'fail', '2026-10-28T23:02:00+01:00', null),
      event('recovered', 'ok', '2026-10-28T23:03:00+01:00', null),
    ].join('\n'));
    const instance = app();
    const [htmlResponse, jsonResponse] = await Promise.all([
      instance.request(`/digest/${night}`), instance.request(`/api/digest/${night}`),
    ]);
    expect(htmlResponse.status).toBe(200);
    expect(htmlResponse.headers.get('content-type')).toContain('text/html');
    expect(jsonResponse.status).toBe(200);
    expect(jsonResponse.headers.get('content-type')).toContain('application/json');

    const digest = await jsonResponse.json();
    const html = await htmlResponse.text();
    expect(digest.rows.map((row: { job: string }) => row.job)).toEqual(['a&<job>', 'recovered', 'z-job']);
    expect(html.indexOf('a&amp;&lt;job&gt;')).toBeLessThan(html.indexOf('recovered'));
    expect(html.indexOf('recovered')).toBeLessThan(html.indexOf('z-job'));
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;owner&gt;');
    expect(html).toContain('failed &amp; &lt;unsafe&gt;');
    expect(html).toContain('—');
    expect(html).toContain('2026-10-28T23:00:00+05:30');
    expect(html).toContain('2026-10-29T02:00:00+05:30');
    expect(html).toContain('class="warn"');
    expect(digest.rows.find((row: { job: string }) => row.job === 'z-job')).toMatchObject({ retries: 3, hadFailure: false });
    expect(digest.rows.find((row: { job: string }) => row.job === 'recovered')).toMatchObject({ hadFailure: true, lastStatus: 'ok' });
    expect(digest.rows.find((row: { job: string }) => row.job === 'a&<job>')).toMatchObject({ owner: '<owner>', hadFailure: true });
  });

  it('returns 404 for missing nights and invalid or path-like names, never a server error', async () => {
    const instance = app();
    for (const route of ['/digest/2026-10-25', '/api/digest/2026-10-25']) {
      expect((await instance.request(route)).status).toBe(404);
    }
    for (const name of ['not-a-night', '../2026-10-28', '%2e%2e%2f2026-10-28', '2026-10-28.jsonl']) {
      for (const prefix of ['/digest/', '/api/digest/']) {
        const response = await instance.request(`${prefix}${name}`);
        expect(response.status, `${prefix}${name}`).toBe(404);
        expect(response.status).not.toBe(500);
      }
    }
  });

  it('renders an empty night and returns an empty JSON digest', async () => {
    writeNight('');
    const instance = app();
    const html = await instance.request(`/digest/${night}`);
    const json = await instance.request(`/api/digest/${night}`);
    expect(html.status).toBe(200);
    expect(await html.text()).toContain('nothing ran');
    expect(json.status).toBe(200);
    expect(await json.json()).toEqual({ night, rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } });
  });

  it('counts malformed JSON and invalid shapes without crashing either route', async () => {
    writeNight(['{broken', 'null', '[]', '{}', JSON.stringify({ at: 'bad', job: 12, status: 'unknown', owner: {} })].join('\n'));
    const instance = app();
    const html = await instance.request(`/digest/${night}`);
    const json = await instance.request(`/api/digest/${night}`);
    expect(html.status).toBe(200);
    expect(await html.text()).toContain('5 malformed lines skipped.');
    expect(json.status).toBe(200);
    expect(await json.json()).toEqual({ night, rows: [], badLines: 5, counts: { ok: 0, retry: 0, fail: 0 } });
  });

  it('renders a null owner in HTML and keeps null in the API', async () => {
    writeNight(event('job', 'ok', '2026-10-28T23:00:00+01:00', null));
    const instance = app();
    expect(await (await instance.request(`/digest/${night}`)).text()).toContain('—');
    expect((await (await instance.request(`/api/digest/${night}`)).json()).rows[0].owner).toBeNull();
  });

  it('links both on-disk board nights to pages that render', async () => {
    const fixtureDir = new URL('../runs/', import.meta.url);
    const instance = createApp({ ...config, runsDir: fixtureDir.pathname });
    const boardResponse = await instance.request('/');
    expect(boardResponse.status).toBe(200);
    const board = await boardResponse.text();
    const nights = [...board.matchAll(/href="\/digest\/(\d{4}-\d{2}-\d{2})"/g)].map((match) => match[1]);
    expect(nights).toHaveLength(2);
    for (const date of nights) {
      const digest = await instance.request(`/digest/${date}`);
      expect(digest.status, date).toBe(200);
      expect(await digest.text()).toContain(`digest · ${date}`);
    }
  });
});
