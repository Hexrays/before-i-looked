import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/reader.js';

const fixturesDir = fileURLToPath(new URL('./fixtures/digest/', import.meta.url));
const realRunsDir = fileURLToPath(new URL('../runs/', import.meta.url));
const night = '2026-10-28';
const valid = { at: '2026-10-28T23:00:00+01:00', job: 'job', status: 'ok', owner: null };
const emptyDigest = { night, rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } };

let runsDir: string;
beforeEach(() => { runsDir = mkdtempSync(join(tmpdir(), 'rig-reader-')); });
afterEach(() => { rmSync(runsDir, { recursive: true, force: true }); });

function writeNight(source: string) {
  writeFileSync(join(runsDir, `${night}.jsonl`), source);
}

describe('readNight', () => {
  it('reads the real night without changing it: five jobs and one bad line', () => {
    const file = join(realRunsDir, `${night}.jsonl`);
    const before = readFileSync(file);
    const digest = readNight(realRunsDir, night);
    expect(digest).toEqual({
      night,
      badLines: 1,
      counts: { ok: 10, retry: 4, fail: 1 },
      rows: [
        { job: 'digest/render', owner: null, runs: 1, retries: 0, lastStatus: 'ok', lastError: null,
          firstAt: '2026-10-29T05:41:09+01:00', lastAt: '2026-10-29T05:41:09+01:00', hadFailure: false },
        { job: 'fixtures/refresh', owner: 'rook', runs: 4, retries: 3, lastStatus: 'ok', lastError: 'upstream 503',
          firstAt: '2026-10-29T01:30:00+01:00', lastAt: '2026-10-29T01:37:00+01:00', hadFailure: false },
        { job: 'lane/sync', owner: 'rook', runs: 8, retries: 1, lastStatus: 'ok', lastError: 'lock held',
          firstAt: '2026-10-28T23:00:06+01:00', lastAt: '2026-10-29T05:00:04+01:00', hadFailure: false },
        { job: 'notes/backup', owner: 'lane-07', runs: 1, retries: 0, lastStatus: 'fail', lastError: 'quota exceeded',
          firstAt: '2026-10-29T04:00:01+01:00', lastAt: '2026-10-29T04:00:01+01:00', hadFailure: true },
        { job: 'rig/rotate-logs', owner: 'lane-07', runs: 1, retries: 0, lastStatus: 'ok', lastError: null,
          firstAt: '2026-10-28T23:00:02+01:00', lastAt: '2026-10-28T23:00:02+01:00', hadFailure: false },
      ],
    });
    expect(readFileSync(file)).toEqual(before);
  });

  it('groups in source order, preserves offsets, and sorts with string comparisons', () => {
    const digest = readNight(fixturesDir, '2026-10-27');
    expect(digest?.rows.map((row) => row.job)).toEqual(['Z-job', '__proto__', 'a-job', 'Ä-job']);
    expect(digest?.rows.find((row) => row.job === 'a-job')).toEqual({
      job: 'a-job', owner: null, runs: 3, retries: 1, lastStatus: 'ok', lastError: 'last error',
      firstAt: '2026-10-28T01:30:00+05:30', lastAt: '2026-10-27T23:00:00-04:30', hadFailure: true,
    });
    expect(digest?.rows.find((row) => row.job === '__proto__')).toMatchObject({
      owner: null, runs: 2, lastError: '', firstAt: '2026-10-28T01:33:00.123-04:30',
    });
    expect(digest?.rows.find((row) => row.job === 'Z-job')?.owner).toBe('latest');
    expect(digest?.night).toBe('2026-10-27');
    expect(digest?.badLines).toBe(0);
    expect(digest?.counts).toEqual({ ok: 6, retry: 1, fail: 1 });
    expect(digest?.rows.reduce((total, row) => total + row.runs, 0)).toBe(8);
    expect(digest?.rows.reduce((total, row) => total + row.retries, 0)).toBe(1);
  });

  it('counts malformed nonblank lines once and continues past them', () => {
    const invalid: unknown[] = [
      null, [], 42, 'text', true, {},
      { ...valid, at: undefined }, { ...valid, at: 42 },
      { ...valid, job: undefined }, { ...valid, job: null }, { ...valid, job: 42 },
      { ...valid, status: undefined }, { ...valid, status: 'unknown' }, { ...valid, status: 42 },
      { ...valid, owner: undefined }, { ...valid, owner: 42 }, { ...valid, owner: {} },
      { ...valid, error: null }, { ...valid, error: 42 }, { ...valid, error: [] },
    ];
    writeNight([
      JSON.stringify({ ...valid, status: 'fail', error: 'retained' }),
      ...invalid.map((value) => JSON.stringify(value)),
      '{broken', 'null trailing text', '', '   ', '\t',
      JSON.stringify(valid),
    ].join('\r\n'));
    const digest = readNight(runsDir, night);
    expect(digest?.badLines).toBe(invalid.length + 2);
    expect(digest?.counts).toEqual({ ok: 1, retry: 0, fail: 1 });
    expect(digest?.rows).toEqual([{
      job: 'job', owner: null, runs: 2, retries: 0, lastStatus: 'ok', lastError: 'retained',
      firstAt: valid.at, lastAt: valid.at, hadFailure: true,
    }]);
  });

  it.each([
    '', 'not a timestamp', '2026-10-28', '2026-10-28T23:00:00',
    '2026-10-28T23:00:00+24:00', '2026-10-28T23:00:00+01:60',
    '2026-10-28T24:01:00Z', '2026-10-28T23:60:00Z', '2026-10-28T23:00:60Z',
    '2026-02-30T23:00:00Z', '2026-02-29T23:00:00Z', '2026-13-01T23:00:00Z',
    '2026-10-28T23:00:00Z\n',
  ])('counts invalid timestamp %j as a bad line', (at) => {
    writeNight(JSON.stringify({ ...valid, at }));
    expect(readNight(runsDir, night)).toEqual({ ...emptyDigest, badLines: 1 });
  });

  it('accepts a leap-day timestamp without changing it', () => {
    const at = '2024-02-29T23:59:59.123456Z';
    writeNight(JSON.stringify({ ...valid, at }));
    expect(readNight(runsDir, night)?.rows[0]).toMatchObject({ firstAt: at, lastAt: at });
  });

  it.each(['', '\n \r\n\t\n'])('returns an empty digest for empty or blank input %j', (source) => {
    writeNight(source);
    expect(readNight(runsDir, night)).toEqual(emptyDigest);
  });

  it('returns null for a missing file or missing runs directory', () => {
    expect(readNight(runsDir, night)).toBeNull();
    expect(readNight(join(runsDir, 'missing'), night)).toBeNull();
  });

  it('propagates file-system errors other than ENOENT', () => {
    mkdirSync(join(runsDir, `${night}.jsonl`));
    expect(() => readNight(runsDir, night)).toThrow();
    writeFileSync(join(runsDir, 'not-a-directory'), '');
    expect(() => readNight(join(runsDir, 'not-a-directory'), night)).toThrow();
  });

  it.each([
    '../2026-10-28', '../../2026-10-28', '/2026-10-28', '..\\2026-10-28',
    '%2e%2e%2f2026-10-28', '2026-10-28/../2026-10-27', '2026-10-28.jsonl',
    '2026-10-28\n', '2026-10-28\0', '2026-1-1', '',
  ])('rejects unsafe or malformed night %j before file access', (name) => {
    expect(() => readNight(join(runsDir, 'missing'), name)).toThrow('night must be a YYYY-MM-DD name');
  });
});
