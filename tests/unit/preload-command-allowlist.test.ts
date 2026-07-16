import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { APPLICATION_COMMAND_IDS } from '../../src/shared/application-commands';

describe('sandboxed preload command allowlist', () => {
  it('stays in exact parity with the canonical application command identifiers', () => {
    const preloadSource = fs.readFileSync(path.resolve(process.cwd(), 'electron/preload/index.ts'), 'utf8');
    const allowlistBody = preloadSource.match(
      /const PRELOAD_APPLICATION_COMMAND_IDS = \[([\s\S]*?)\] as const satisfies/,
    )?.[1];
    expect(allowlistBody, 'preload command allowlist declaration').toBeDefined();
    const preloadIds = Array.from(allowlistBody!.matchAll(/'([^']+)'/g), (match) => match[1]);
    expect(preloadIds).toEqual(APPLICATION_COMMAND_IDS);
  });
});
