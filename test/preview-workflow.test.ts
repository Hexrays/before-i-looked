import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const exec = promisify(execFile);
const workflow = readFileSync(new URL('../.github/workflows/preview-pages.yml', import.meta.url), 'utf8');
// Exercise the actual export shell block without installing, uploading, or deploying.
const exportShell = workflow.match(/        run: \|\n((?:          .*\n)+)/)?.[1]
  .replace(/^ {10}/gm, '');

async function checkGuard(withMarker: boolean, marker: string) {
  expect(exportShell).toBeDefined();
  return exec('bash', ['--noprofile', '--norc', '-euo', 'pipefail', '-c', `
    pnpm() {
      [[ "$1" == "export:preview" ]]
      if [[ "$WITH_MARKER" == "true" ]]; then
        [[ "$LANE_MARKER" == "$EXPECTED_MARKER" ]]
      else
        [[ -z "\${LANE_MARKER+x}" ]]
      fi
    }
    ${exportShell}
  `], {
    env: { ...process.env, WITH_MARKER: String(withMarker), LANE_MARKER: marker, EXPECTED_MARKER: marker },
    timeout: 5_000,
  });
}

describe('preview workflow safety', () => {
  it('has only manual dispatch with an unmarked default', () => {
    const triggers = workflow.match(/^on:\n([\s\S]*?)(?=^\S)/m)?.[1];
    expect(triggers?.match(/^ {2}\w+:/gm)).toEqual(['  workflow_dispatch:']);
    expect(triggers).toMatch(/with_marker:[\s\S]*type: boolean[\s\S]*default: false/);
    expect(workflow).toContain("LANE_MARKER: ${{ inputs.with_marker && secrets.LANE_MARKER || '' }}");
  });

  it('fails marked publication when the secret is missing or whitespace-only', async () => {
    for (const marker of ['', ' \t\n']) {
      await expect(checkGuard(true, marker)).rejects.toMatchObject({
        code: 1, stdout: expect.stringContaining('Marked publication requires the LANE_MARKER repository secret.'),
      });
    }
  });

  it('passes an approved marker to export without printing it', async () => {
    const marker = randomUUID();
    const result = await checkGuard(true, marker);
    expect(result.stdout + result.stderr).not.toContain(marker);
  });

  it('unsets the marker for clean publication without printing it', async () => {
    const marker = randomUUID();
    const result = await checkGuard(false, marker);
    expect(result.stdout + result.stderr).not.toContain(marker);
  });
});
