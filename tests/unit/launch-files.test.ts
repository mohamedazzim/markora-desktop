import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { existingLaunchMarkdownPaths, extractLaunchMarkdownPaths } from '../../electron/main/launch-files';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    temporaryDirectories.splice(0).map((item) => fs.rm(item, { recursive: true, force: true })),
  );
});

describe('Windows launch-file argument validation', () => {
  it('extracts multiple packaged Markdown operands and ignores unrelated files', () => {
    const cwd = path.resolve('C:\\Notes');
    expect(
      extractLaunchMarkdownPaths(['Markora.exe', 'one.md', 'nested/two.markdown', 'image.png'], {
        isPackaged: true,
        workingDirectory: cwd,
      }),
    ).toEqual([path.resolve(cwd, 'one.md'), path.resolve(cwd, 'nested/two.markdown')]);
  });

  it('skips Chromium switches and the development project entry', () => {
    const cwd = path.resolve('C:\\repo');
    expect(
      extractLaunchMarkdownPaths(
        ['electron.exe', '--user-data-dir', 'C:\\tmp\\profile', cwd, 'document.md'],
        { isPackaged: false, workingDirectory: cwd },
      ),
    ).toEqual([path.resolve(cwd, 'document.md')]);
  });

  it('does not interpret a switch value ending in Markdown as a file operand', () => {
    expect(
      extractLaunchMarkdownPaths(['Markora.exe', '--log-file', 'diagnostic.md', '--inspect=9229'], {
        isPackaged: true,
        workingDirectory: process.cwd(),
      }),
    ).toEqual([]);
  });

  it('accepts a file URL and decodes Unicode paths', () => {
    const unicodePath = path.resolve('नोट.md');
    expect(
      extractLaunchMarkdownPaths(['Markora.exe', pathToFileURL(unicodePath).href], {
        isPackaged: true,
        workingDirectory: process.cwd(),
      }),
    ).toEqual([unicodePath]);
  });

  it('deduplicates paths case-insensitively on Windows', () => {
    const first = path.resolve('Case.md');
    const second = process.platform === 'win32' ? first.toUpperCase() : first;
    expect(
      extractLaunchMarkdownPaths(['Markora.exe', first, second], {
        isPackaged: true,
        workingDirectory: process.cwd(),
      }),
    ).toEqual([first]);
  });

  it('rejects malformed, overlong, and unsupported operands', () => {
    expect(
      extractLaunchMarkdownPaths(
        ['Markora.exe', 'bad\0.md', `${'a'.repeat(32_768)}.md`, 'notes.txt', 'https://example.test/a.md'],
        { isPackaged: true, workingDirectory: process.cwd() },
      ),
    ).toEqual([]);
  });

  it('keeps only accessible regular files before granting renderer authority', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'markora-launch-'));
    temporaryDirectories.push(root);
    const file = path.join(root, 'exists.md');
    const directory = path.join(root, 'folder.markdown');
    await fs.writeFile(file, '# Existing', 'utf8');
    await fs.mkdir(directory);
    await expect(
      existingLaunchMarkdownPaths(['Markora.exe', file, directory, path.join(root, 'missing.md')], {
        isPackaged: true,
        workingDirectory: root,
      }),
    ).resolves.toEqual([file]);
  });

  it('tolerates a shell operand disappearing during validation', async () => {
    const candidate = path.resolve('gone.md');
    const stat = vi.fn().mockRejectedValue(Object.assign(new Error('gone'), { code: 'ENOENT' }));
    await expect(
      existingLaunchMarkdownPaths(
        ['Markora.exe', candidate],
        { isPackaged: true, workingDirectory: process.cwd() },
        { stat },
      ),
    ).resolves.toEqual([]);
  });
});
