import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HtmlExportRequest } from '../../src/shared/html-export';
import { defaultHtmlExportOptions } from '../../src/shared/html-export';

const electronMocks = vi.hoisted(() => {
  const registeredHandlers = new Map<string, (...arguments_: unknown[]) => unknown>();
  return {
    registeredHandlers,
    handle: vi.fn((channel: string, handler: (...arguments_: unknown[]) => unknown) => {
      registeredHandlers.set(channel, handler);
    }),
    showSaveDialog: vi.fn(),
  };
});

vi.mock('electron', () => ({
  ipcMain: { handle: electronMocks.handle },
  dialog: { showSaveDialog: electronMocks.showSaveDialog },
}));

const { registeredHandlers: handlers, handle, showSaveDialog } = electronMocks;

import {
  htmlExportChannels,
  parseHtmlExportRequest,
  registerHtmlExportIpc,
} from '../../electron/main/html-export-ipc';
import {
  authorizeFile,
  authorizeWorkspace,
  clearPathAuthorityForTests,
} from '../../electron/main/path-authority';

let temporaryDirectory = '';

function request(overrides: Partial<HtmlExportRequest> = {}): HtmlExportRequest {
  return {
    markdown: '# Export',
    options: { ...defaultHtmlExportOptions, syntaxHighlighting: false },
    ...overrides,
  };
}

beforeEach(async () => {
  temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'markora-html-ipc-'));
  handlers.clear();
  handle.mockClear();
  showSaveDialog.mockReset();
  clearPathAuthorityForTests();
  registerHtmlExportIpc();
});

afterEach(async () => {
  await fs.rm(temporaryDirectory, { recursive: true, force: true });
});

describe('HTML export IPC validation', () => {
  it('accepts the complete typed request', () => {
    expect(parseHtmlExportRequest(request())).toEqual(request());
  });

  it('rejects unknown request and option fields', () => {
    expect(() => parseHtmlExportRequest({ ...request(), injected: true })).toThrow();
    expect(() =>
      parseHtmlExportRequest({ ...request(), options: { ...defaultHtmlExportOptions, injected: true } }),
    ).toThrow();
  });

  it('rejects invalid themes and overlong metadata', () => {
    expect(() =>
      parseHtmlExportRequest({
        ...request(),
        options: { ...defaultHtmlExportOptions, theme: 'remote-theme' },
      }),
    ).toThrow();
    expect(() =>
      parseHtmlExportRequest({
        ...request(),
        options: { ...defaultHtmlExportOptions, metadata: { title: 'x'.repeat(501) } },
      }),
    ).toThrow();
  });

  it('registers separate preview and write handlers', () => {
    expect(handle).toHaveBeenCalledTimes(2);
    expect(handlers.has(htmlExportChannels.preview)).toBe(true);
    expect(handlers.has(htmlExportChannels.write)).toBe(true);
  });

  it('previews an authorized source file', async () => {
    const sourcePath = authorizeFile(path.join(temporaryDirectory, 'note.md'));
    await fs.writeFile(sourcePath, '# Preview');
    const result = (await handlers.get(htmlExportChannels.preview)!({}, request({ sourcePath }))) as {
      html: string;
    };
    expect(result.html).toContain('<title>Export</title>');
  });

  it('rejects an unapproved source or workspace path', async () => {
    const sourcePath = path.join(temporaryDirectory, 'unapproved.md');
    await fs.writeFile(sourcePath, '# Private');
    await expect(handlers.get(htmlExportChannels.preview)!({}, request({ sourcePath }))).rejects.toThrow(
      'not selected',
    );
    await expect(
      handlers.get(htmlExportChannels.preview)!({}, request({ workspaceRoot: temporaryDirectory })),
    ).rejects.toThrow('workspace was not selected');
  });

  it('writes only to the path returned by the native save dialog', async () => {
    const workspaceRoot = authorizeWorkspace(temporaryDirectory);
    const sourcePath = path.join(workspaceRoot, 'note.md');
    await fs.writeFile(sourcePath, '# Approved');
    const outputPath = path.join(temporaryDirectory, 'approved.html');
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: outputPath });

    const result = (await handlers.get(htmlExportChannels.write)!(
      {},
      request({ sourcePath, workspaceRoot }),
    )) as { path: string };
    expect(result.path).toBe(path.resolve(outputPath));
    expect(await fs.readFile(outputPath, 'utf8')).toContain('<title>Export</title>');
    expect(showSaveDialog).toHaveBeenCalledWith(expect.objectContaining({ title: 'Export HTML' }));
  });

  it('returns null when the user cancels the native save dialog', async () => {
    showSaveDialog.mockResolvedValue({ canceled: true });
    await expect(handlers.get(htmlExportChannels.write)!({}, request())).resolves.toBeNull();
  });
});
