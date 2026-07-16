import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const DEVELOPMENT_SERVER_URL = 'http://127.0.0.1:5173/';

export function applicationEntryUrl(isPackaged: boolean, compiledMainDirectory: string): string {
  return isPackaged
    ? pathToFileURL(path.join(compiledMainDirectory, '../../../dist/index.html')).href
    : DEVELOPMENT_SERVER_URL;
}

/** Allows only the exact Vite origin or the exact packaged entry document. */
export function isAllowedApplicationNavigation(target: string, applicationEntry: string): boolean {
  try {
    const candidate = new URL(target);
    const entry = new URL(applicationEntry);
    if (entry.protocol === 'file:') {
      return (
        candidate.protocol === 'file:' &&
        candidate.host === entry.host &&
        candidate.pathname === entry.pathname
      );
    }
    return candidate.origin === entry.origin && candidate.username === '' && candidate.password === '';
  } catch {
    return false;
  }
}
