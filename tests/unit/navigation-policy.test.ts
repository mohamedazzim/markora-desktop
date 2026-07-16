import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  applicationEntryUrl,
  DEVELOPMENT_SERVER_URL,
  isAllowedApplicationNavigation,
} from '../../electron/main/navigation-policy';

describe('main-window navigation policy', () => {
  it('uses the exact IPv4 Vite development origin', () => {
    expect(applicationEntryUrl(false, process.cwd())).toBe(DEVELOPMENT_SERVER_URL);
    expect(DEVELOPMENT_SERVER_URL).toBe('http://127.0.0.1:5173/');
  });

  it('allows routes on the exact dev origin and rejects origin-confusable hosts', () => {
    expect(isAllowedApplicationNavigation('http://127.0.0.1:5173/src/app.js', DEVELOPMENT_SERVER_URL)).toBe(
      true,
    );
    expect(isAllowedApplicationNavigation('http://127.0.0.1:5173.evil.test/', DEVELOPMENT_SERVER_URL)).toBe(
      false,
    );
    expect(isAllowedApplicationNavigation('http://127.0.0.1:5174/', DEVELOPMENT_SERVER_URL)).toBe(false);
    expect(isAllowedApplicationNavigation('http://user@127.0.0.1:5173/', DEVELOPMENT_SERVER_URL)).toBe(false);
    expect(isAllowedApplicationNavigation('https://127.0.0.1:5173/', DEVELOPMENT_SERVER_URL)).toBe(false);
  });

  it('generates an encoded file URL for packaged paths containing spaces and Unicode', () => {
    const compiled = path.join(process.cwd(), 'build output मुख्य', 'dist-electron', 'electron', 'main');
    const url = applicationEntryUrl(true, compiled);
    expect(url).toMatch(/^file:\/\//);
    expect(url).toContain('build%20output');
    expect(url).not.toContain('build output');
  });

  it('allows only the exact packaged entry document while permitting a fragment', () => {
    const entry = applicationEntryUrl(true, path.join(process.cwd(), 'dist-electron', 'electron', 'main'));
    expect(isAllowedApplicationNavigation(`${entry}#heading`, entry)).toBe(true);
    expect(isAllowedApplicationNavigation(entry.replace('index.html', 'other.html'), entry)).toBe(false);
    expect(isAllowedApplicationNavigation('file:///C:/Windows/System32/drivers/etc/hosts', entry)).toBe(
      false,
    );
    expect(isAllowedApplicationNavigation('not a URL', entry)).toBe(false);
  });
});
