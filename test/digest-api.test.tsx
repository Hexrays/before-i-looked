import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { readNight } from '../src/digest/reader.js';

const config = { adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir: 'runs' };

 describe('digest JSON route', () => {
  it('returns the shared digest for a night', async () => {
    const response = await createApp(config).request('/api/digest/2026-10-28');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(readNight(config.runsDir, '2026-10-28'));
  });

  it('returns 404 for missing and invalid nights', async () => {
    const app = createApp(config);
    expect((await app.request('/api/digest/2026-10-25')).status).toBe(404);
    expect((await app.request('/api/digest/not-a-night')).status).toBe(404);
  });
});
