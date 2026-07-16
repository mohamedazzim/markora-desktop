import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface LaunchArgumentOptions {
  readonly isPackaged: boolean;
  readonly workingDirectory: string;
}

const switchesWithSeparateValues = new Set([
  '--inspect',
  '--inspect-brk',
  '--log-file',
  '--remote-debugging-port',
  '--user-data-dir',
]);

function asFilePath(argument: string, workingDirectory: string): string | null {
  if (!argument || argument.includes('\0') || argument.length > 32_767) return null;
  let candidate = argument;
  if (/^file:/i.test(candidate)) {
    try {
      candidate = fileURLToPath(candidate);
    } catch {
      return null;
    }
  } else if (/^[a-z][a-z\d+.-]*:/i.test(candidate) && !/^[a-z]:[\\/]/i.test(candidate)) {
    return null;
  }
  const resolved = path.resolve(workingDirectory, candidate);
  const extension = path.extname(resolved).toLocaleLowerCase();
  return extension === '.md' || extension === '.markdown' ? resolved : null;
}

/**
 * Extracts only Markdown file operands from Electron/NSIS command lines. Browser
 * switches, their values, and the development app-entry operand are ignored.
 */
export function extractLaunchMarkdownPaths(
  argv: readonly string[],
  options: LaunchArgumentOptions,
): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  let afterSeparator = false;
  let skippedDevelopmentEntry = options.isPackaged;

  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!afterSeparator && argument === '--') {
      afterSeparator = true;
      continue;
    }
    if (!afterSeparator && argument.startsWith('-')) {
      if (!argument.includes('=') && switchesWithSeparateValues.has(argument.toLocaleLowerCase())) {
        index += 1;
      }
      continue;
    }

    const filePath = asFilePath(argument, options.workingDirectory);
    if (!skippedDevelopmentEntry && !filePath) {
      skippedDevelopmentEntry = true;
      continue;
    }
    if (!filePath) continue;

    const key = process.platform === 'win32' ? filePath.toLocaleLowerCase() : filePath;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(filePath);
  }
  return result;
}

export interface LaunchFileDependencies {
  readonly stat?: typeof fs.stat;
}

/** Rejects directories, deleted shell operands, devices, and inaccessible paths. */
export async function existingLaunchMarkdownPaths(
  argv: readonly string[],
  options: LaunchArgumentOptions,
  dependencies: LaunchFileDependencies = {},
): Promise<string[]> {
  const stat = dependencies.stat ?? fs.stat;
  const candidates = extractLaunchMarkdownPaths(argv, options);
  const existing: string[] = [];
  for (const candidate of candidates) {
    try {
      if ((await stat(candidate)).isFile()) existing.push(candidate);
    } catch {
      // Shell integrations can retain stale recent-file entries. Ignore safely.
    }
  }
  return existing;
}
