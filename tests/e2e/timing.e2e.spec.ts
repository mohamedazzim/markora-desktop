import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { expect, projectRoot, test } from './electron-fixture';

test('records real Electron startup and Mermaid render timings', async ({ markora }, testInfo) => {
  const mermaidStartedAt = performance.now();
  await markora.page.getByRole('button', { name: 'Diagram', exact: true }).click();
  await expect(markora.page.locator('.fence-node.mermaid svg').first()).toBeVisible({ timeout: 20_000 });
  const mermaidRenderMilliseconds = performance.now() - mermaidStartedAt;

  const report = {
    capturedAt: new Date().toISOString(),
    platform: process.platform,
    architecture: process.arch,
    electronVersion: await markora.app.evaluate(() => process.versions.electron),
    startupMilliseconds: Number(markora.startupMilliseconds.toFixed(2)),
    mermaidRenderMilliseconds: Number(mermaidRenderMilliseconds.toFixed(2)),
  };

  expect(report.startupMilliseconds).toBeGreaterThan(0);
  expect(report.mermaidRenderMilliseconds).toBeGreaterThan(0);

  const reportPath = path.join(projectRoot, 'test-results', 'e2e-timing.json');
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await testInfo.attach('e2e-timing.json', {
    body: Buffer.from(JSON.stringify(report, null, 2)),
    contentType: 'application/json',
  });
});
