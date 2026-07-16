import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AssetOperationError,
  calculateMarkdownAssetPath,
  copyLocalImageAsset,
  downloadRemoteImageAsset,
  formatMarkdownImageDestination,
  resolveAssetBaseDirectory,
  resolveAssetDestination,
  resolveLocalImageReference,
  sanitizeWindowsFilename,
  writeClipboardImageAsset,
  type AssetContext,
  type DownloadRemoteImageRequest,
} from '../../electron/main/image-assets';

const temporaryDirectories: string[] = [];

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'markora-assets-'));
  temporaryDirectories.push(directory);
  return directory;
}

async function createContext(): Promise<{
  root: string;
  workspace: string;
  documentPath: string;
  context: AssetContext;
}> {
  const root = await createTemporaryDirectory();
  const workspace = path.join(root, 'workspace');
  const documentDirectory = path.join(workspace, 'notes');
  const documentPath = path.join(documentDirectory, 'Résumé.md');
  await mkdir(documentDirectory, { recursive: true });
  await writeFile(documentPath, '# Test\n');
  return {
    root,
    workspace,
    documentPath,
    context: { documentPath, workspaceRoot: workspace },
  };
}

function expectAssetError(error: unknown, code: string): void {
  expect(error).toBeInstanceOf(AssetOperationError);
  expect((error as AssetOperationError).code).toBe(code);
}

function imageResponse(
  bytes: Uint8Array = new Uint8Array([137, 80, 78, 71]),
  init: ConstructorParameters<typeof Response>[1] = {},
): Response {
  const headers = new Headers(init.headers);
  if (!headers.has('content-type')) headers.set('content-type', 'image/png');
  return new Response(new Uint8Array(bytes).buffer, { ...init, headers });
}

function remoteRequest(
  context: AssetContext,
  fetchImpl: typeof fetch,
  overrides: Partial<DownloadRemoteImageRequest> = {},
): DownloadRemoteImageRequest {
  return {
    url: 'https://example.test/images/photo.png',
    strategy: 'assets',
    filename: '',
    context,
    fetchImpl,
    ...overrides,
  };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('Windows asset filename safety', () => {
  it('replaces invalid Windows characters and removes trailing dots and spaces', () => {
    expect(sanitizeWindowsFilename('a<b>:c?.png. ')).toBe('a_b_c_.png');
  });

  it.each(['CON.png', 'aux', 'LPT9.jpg', 'conout$.gif'])('protects reserved device name %s', (name) => {
    expect(sanitizeWindowsFilename(name)).toMatch(/^_/u);
  });

  it('normalizes Unicode while preserving a readable Unicode filename', () => {
    expect(sanitizeWindowsFilename('Re\u0301sume\u0301 🖼️.png')).toBe('Résumé 🖼️.png');
  });

  it('uses a fallback for empty and dot-only names', () => {
    expect(sanitizeWindowsFilename('...')).toBe('image');
    expect(sanitizeWindowsFilename('  ', 'pasted-image')).toBe('pasted-image');
  });

  it('bounds a component without splitting Unicode code points', () => {
    const result = sanitizeWindowsFilename(`${'🖼️'.repeat(100)}.png`, 'image', 40);
    expect(Array.from(result).length).toBeLessThanOrEqual(40);
    expect(result.endsWith('.png')).toBe(true);
  });

  it('rejects unsafe component length configuration', () => {
    expect(() => sanitizeWindowsFilename('image.png', 'image', 4)).toThrow(AssetOperationError);
  });
});

describe('asset destination strategies', () => {
  it('resolves each document and workspace strategy', async () => {
    const { context, documentPath, workspace } = await createContext();

    expect(resolveAssetBaseDirectory('document-sibling', context)).toBe(path.dirname(documentPath));
    expect(resolveAssetBaseDirectory('assets', context)).toBe(
      path.join(path.dirname(documentPath), 'assets'),
    );
    expect(resolveAssetBaseDirectory('document-assets', context)).toBe(
      path.join(path.dirname(documentPath), 'Résumé.assets'),
    );
    expect(resolveAssetBaseDirectory('workspace-assets', context)).toBe(
      path.join(workspace, 'assets'),
    );
  });

  it('uses workspace assets for unsaved documents', async () => {
    const root = await createTemporaryDirectory();
    expect(
      resolveAssetBaseDirectory('workspace-assets', {
        workspaceRoot: root,
        workspaceAssetDirectoryName: 'media',
      }),
    ).toBe(path.join(root, 'media'));
  });

  it('rejects document strategies for unsaved documents', () => {
    for (const strategy of ['document-sibling', 'assets', 'document-assets'] as const) {
      try {
        resolveAssetBaseDirectory(strategy, {});
        throw new Error('Expected the destination to fail.');
      } catch (error) {
        expectAssetError(error, 'UNSAVED_DOCUMENT');
      }
    }
  });

  it('rejects workspace strategy without a workspace', () => {
    expect(() => resolveAssetBaseDirectory('workspace-assets', {})).toThrowError(
      expect.objectContaining({ code: 'WORKSPACE_REQUIRED' }),
    );
  });

  it('creates stable date-based directories under the workspace', async () => {
    const root = await createTemporaryDirectory();
    const result = resolveAssetBaseDirectory('date-based', {
      workspaceRoot: root,
      now: new Date(2026, 6, 15, 12, 0, 0),
    });
    expect(result).toBe(path.join(root, 'assets', '2026', '07', '15'));
  });

  it('creates stable date-based directories next to a saved document without a workspace', async () => {
    const root = await createTemporaryDirectory();
    const result = resolveAssetBaseDirectory('date-based', {
      documentPath: path.join(root, 'note.md'),
      now: new Date(2024, 0, 2),
    });
    expect(result).toBe(path.join(root, 'assets', '2024', '01', '02'));
  });

  it('selects non-destructive duplicate names and preserves the extension', async () => {
    const { context, documentPath } = await createContext();
    const directory = path.join(path.dirname(documentPath), 'assets');
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'diagram.png'), 'one');
    await writeFile(path.join(directory, 'diagram (1).png'), 'two');

    const destination = await resolveAssetDestination({
      strategy: 'assets',
      filename: 'diagram.png',
      context,
    });
    expect(destination.filename).toBe('diagram (2).png');
    expect(destination.renamedForConflict).toBe(true);
  });

  it('supports explicit conflict errors and overwrite selection', async () => {
    const { context, documentPath } = await createContext();
    const directory = path.join(path.dirname(documentPath), 'assets');
    await mkdir(directory, { recursive: true });
    const existing = path.join(directory, 'same.png');
    await writeFile(existing, 'old');

    await expect(
      resolveAssetDestination({
        strategy: 'assets',
        filename: 'same.png',
        context,
        conflictPolicy: 'error',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT', path: existing });
    await expect(
      resolveAssetDestination({
        strategy: 'assets',
        filename: 'same.png',
        context,
        conflictPolicy: 'overwrite',
      }),
    ).resolves.toMatchObject({ assetPath: existing, renamedForConflict: false });
  });

  it('surfaces a path-length error before filesystem mutation', async () => {
    const root = await createTemporaryDirectory();
    const deeplyNested = path.join(root, 'a'.repeat(245), 'note.md');
    await expect(
      resolveAssetDestination({
        strategy: 'assets',
        filename: 'picture.png',
        context: { documentPath: deeplyNested, maxPathLength: 260 },
      }),
    ).rejects.toMatchObject({ code: 'PATH_TOO_LONG' });
  });

  it('surfaces destination creation failures as structured errors', async () => {
    const { context, documentPath } = await createContext();
    await writeFile(path.join(path.dirname(documentPath), 'assets'), 'not a directory');
    await expect(
      resolveAssetDestination({ strategy: 'assets', filename: 'image.png', context }),
    ).rejects.toMatchObject({ code: 'WRITE_FAILED' });
  });

  it('rejects invalid runtime strategy and conflict-policy values at the service boundary', async () => {
    const { context } = await createContext();
    await expect(
      resolveAssetDestination({
        strategy: 'unknown' as 'assets',
        filename: 'image.png',
        context,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(
      resolveAssetDestination({
        strategy: 'assets',
        filename: 'image.png',
        context,
        conflictPolicy: 'unknown' as 'rename',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
});

describe('Markdown image path calculation', () => {
  it('calculates document-relative paths with Markdown separators', async () => {
    const { context, workspace } = await createContext();
    const imagePath = path.join(workspace, 'assets', 'diagram.png');
    expect(calculateMarkdownAssetPath(imagePath, context, 'document-relative')).toEqual({
      value: '../assets/diagram.png',
      kind: 'document-relative',
    });
  });

  it('calculates workspace-relative paths and rejects outside images', async () => {
    const { context, workspace, root } = await createContext();
    const imagePath = path.join(workspace, 'media', 'photo.png');
    expect(calculateMarkdownAssetPath(imagePath, context, 'workspace-relative')).toEqual({
      value: 'media/photo.png',
      kind: 'workspace-relative',
    });
    expect(() =>
      calculateMarkdownAssetPath(path.join(root, 'outside.png'), context, 'workspace-relative'),
    ).toThrowError(expect.objectContaining({ code: 'OUTSIDE_WORKSPACE' }));
  });

  it('falls back to a workspace path for an unsaved document', async () => {
    const root = await createTemporaryDirectory();
    const imagePath = path.join(root, 'assets', '猫.png');
    expect(calculateMarkdownAssetPath(imagePath, { workspaceRoot: root })).toEqual({
      value: 'assets/猫.png',
      kind: 'workspace-relative',
    });
  });

  it('falls back to an absolute path with no document or workspace', async () => {
    const root = await createTemporaryDirectory();
    const imagePath = path.join(root, 'image.png');
    expect(calculateMarkdownAssetPath(imagePath, {})).toEqual({
      value: imagePath.replace(/\\/gu, '/'),
      kind: 'absolute',
    });
  });

  it('formats whitespace and parentheses safely for Markdown image syntax', () => {
    expect(formatMarkdownImageDestination('assets/my image (1).png')).toBe(
      '<assets/my image (1).png>',
    );
    expect(formatMarkdownImageDestination('assets/plain.png')).toBe('assets/plain.png');
  });
});

describe('existing local image references', () => {
  it('resolves a document-relative image before the workspace fallback', async () => {
    const { documentPath, workspace } = await createContext();
    const localImage = path.join(path.dirname(documentPath), 'images', 'local.png');
    const workspaceImage = path.join(workspace, 'images', 'local.png');
    await mkdir(path.dirname(localImage), { recursive: true });
    await mkdir(path.dirname(workspaceImage), { recursive: true });
    await writeFile(localImage, 'document');
    await writeFile(workspaceImage, 'workspace');

    await expect(
      resolveLocalImageReference({
        reference: 'images/local.png',
        documentPath,
        workspaceRoot: workspace,
      }),
    ).resolves.toBe(localImage);
  });

  it('resolves file URLs including Unicode filenames', async () => {
    const root = await createTemporaryDirectory();
    const image = path.join(root, '猫 photo.png');
    await writeFile(image, 'bytes');
    await expect(
      resolveLocalImageReference({ reference: pathToFileURL(image).href }),
    ).resolves.toBe(image);
  });

  it('reports broken references without silently inventing a path', async () => {
    const { documentPath, workspace } = await createContext();
    await expect(
      resolveLocalImageReference({
        reference: 'missing.png',
        documentPath,
        workspaceRoot: workspace,
      }),
    ).rejects.toMatchObject({ code: 'BROKEN_LOCAL_REFERENCE' });
  });

  it('does not treat a remote URL as a local path', async () => {
    await expect(
      resolveLocalImageReference({ reference: 'https://example.test/image.png' }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
});

describe('local and clipboard asset writes', () => {
  it('copies a local image and returns its document-relative Markdown path', async () => {
    const { root, context, documentPath } = await createContext();
    const source = path.join(root, 'source.png');
    await writeFile(source, new Uint8Array([1, 2, 3]));

    const result = await copyLocalImageAsset({
      sourcePath: source,
      strategy: 'assets',
      filename: 'copied.png',
      context,
    });
    expect(result).toMatchObject({
      sourceKind: 'local',
      copied: true,
      markdownPath: 'assets/copied.png',
      markdownPathKind: 'document-relative',
      byteLength: 3,
    });
    expect(result.assetPath).toBe(path.join(path.dirname(documentPath), 'assets', 'copied.png'));
    expect([...await readFile(result.assetPath)]).toEqual([1, 2, 3]);
  });

  it('renames a duplicate local asset without overwriting the original', async () => {
    const { root, context, documentPath } = await createContext();
    const source = path.join(root, 'source.png');
    const assetDirectory = path.join(path.dirname(documentPath), 'assets');
    await mkdir(assetDirectory, { recursive: true });
    await writeFile(source, 'new');
    await writeFile(path.join(assetDirectory, 'copy.png'), 'old');

    const result = await copyLocalImageAsset({
      sourcePath: source,
      strategy: 'assets',
      filename: 'copy.png',
      context,
    });
    expect(result.filename).toBe('copy (1).png');
    expect(await readFile(path.join(assetDirectory, 'copy.png'), 'utf8')).toBe('old');
  });

  it('keeps an original local path for an unsaved document', async () => {
    const root = await createTemporaryDirectory();
    const source = path.join(root, 'original.png');
    await writeFile(source, 'original');
    const result = await copyLocalImageAsset({
      sourcePath: source,
      strategy: 'keep-original',
      filename: '',
      context: {},
    });
    expect(result).toMatchObject({ copied: false, assetPath: source, markdownPathKind: 'absolute' });
  });

  it('does not duplicate an image already at the selected destination', async () => {
    const { context, documentPath } = await createContext();
    const source = path.join(path.dirname(documentPath), 'already.png');
    await writeFile(source, 'same');
    const result = await copyLocalImageAsset({
      sourcePath: source,
      strategy: 'document-sibling',
      filename: 'already.png',
      context,
    });
    expect(result).toMatchObject({ copied: false, filename: 'already.png' });
  });

  it('overwrites an existing local asset only when explicitly requested', async () => {
    const { root, context, documentPath } = await createContext();
    const source = path.join(root, 'replacement.png');
    const assetDirectory = path.join(path.dirname(documentPath), 'assets');
    const destination = path.join(assetDirectory, 'replace.png');
    await mkdir(assetDirectory, { recursive: true });
    await writeFile(source, 'new bytes');
    await writeFile(destination, 'old bytes');

    const result = await copyLocalImageAsset({
      sourcePath: source,
      strategy: 'assets',
      filename: 'replace.png',
      context,
      conflictPolicy: 'overwrite',
    });
    expect(result.assetPath).toBe(destination);
    expect(await readFile(destination, 'utf8')).toBe('new bytes');
  });

  it('reports missing sources and directory sources separately', async () => {
    const { root, context } = await createContext();
    await expect(
      copyLocalImageAsset({
        sourcePath: path.join(root, 'missing.png'),
        strategy: 'assets',
        filename: 'missing.png',
        context,
      }),
    ).rejects.toMatchObject({ code: 'SOURCE_NOT_FOUND' });
    await expect(
      copyLocalImageAsset({
        sourcePath: root,
        strategy: 'assets',
        filename: 'directory.png',
        context,
      }),
    ).rejects.toMatchObject({ code: 'SOURCE_NOT_FILE' });
  });

  it('writes clipboard bytes with an inferred extension', async () => {
    const { context } = await createContext();
    const bytes = new Uint8Array([9, 8, 7]);
    const result = await writeClipboardImageAsset({
      data: bytes,
      mimeType: 'image/png; charset=binary',
      strategy: 'assets',
      filename: 'pasted-image',
      context,
    });
    expect(result).toMatchObject({
      filename: 'pasted-image.png',
      sourceKind: 'clipboard',
      originalSource: null,
      byteLength: 3,
      mimeType: 'image/png',
    });
    expect([...await readFile(result.assetPath)]).toEqual([...bytes]);
  });

  it('uses the trusted clipboard MIME extension instead of an unsafe supplied extension', async () => {
    const { context } = await createContext();
    const result = await writeClipboardImageAsset({
      data: new Uint8Array([1]),
      mimeType: 'image/png',
      strategy: 'assets',
      filename: 'pasted.exe',
      context,
    });
    expect(result.filename).toBe('pasted.png');
  });

  it('rejects unsupported, oversized, and destination-less clipboard data', async () => {
    const { context } = await createContext();
    const base = {
      data: new Uint8Array([1, 2]),
      mimeType: 'text/plain',
      strategy: 'assets' as const,
      filename: 'clip',
      context,
    };
    await expect(writeClipboardImageAsset(base)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(
      writeClipboardImageAsset({ ...base, mimeType: 'image/png', maxBytes: 1 }),
    ).rejects.toMatchObject({ code: 'DOWNLOAD_TOO_LARGE' });
    await expect(
      writeClipboardImageAsset({ ...base, mimeType: 'image/png', strategy: 'keep-original' }),
    ).rejects.toMatchObject({ code: 'INVALID_DESTINATION' });
  });

  it('serializes actionable errors for typed IPC responses', () => {
    const error = new AssetOperationError('DESTINATION_READ_ONLY', 'Read-only destination.', {
      path: 'C:\\readonly\\image.png',
    });
    expect(error.toJSON()).toEqual({
      name: 'AssetOperationError',
      code: 'DESTINATION_READ_ONLY',
      message: 'Read-only destination.',
      path: 'C:\\readonly\\image.png',
      causeCode: undefined,
      recoverable: true,
    });
  });
});

describe('bounded remote image download', () => {
  it('downloads an image, honors a Unicode Content-Disposition name, and writes it locally', async () => {
    const { context } = await createContext();
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      imageResponse(new Uint8Array([1, 2, 3, 4]), {
        headers: {
          'content-type': 'image/png',
          'content-disposition': "attachment; filename*=UTF-8''%E7%8C%AB.png",
        },
      }),
    );
    const result = await downloadRemoteImageAsset(remoteRequest(context, fetchImpl));
    expect(result).toMatchObject({
      filename: '猫.png',
      sourceKind: 'remote',
      originalSource: 'https://example.test/images/photo.png',
      mimeType: 'image/png',
      byteLength: 4,
      markdownPath: 'assets/猫.png',
    });
    expect([...await readFile(result.assetPath)]).toEqual([1, 2, 3, 4]);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://example.test/images/photo.png',
      expect.objectContaining({ redirect: 'manual', credentials: 'omit' }),
    );
  });

  it('follows bounded relative HTTPS redirects manually', async () => {
    const { context } = await createContext();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: '/cdn/final.webp' } }),
      )
      .mockResolvedValueOnce(imageResponse(new Uint8Array([1]), { headers: { 'content-type': 'image/webp' } }));
    const result = await downloadRemoteImageAsset(remoteRequest(context, fetchImpl));
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://example.test/cdn/final.webp',
      expect.any(Object),
    );
    expect(result.filename).toBe('final.webp');
  });

  it('rejects non-HTTP URLs, embedded credentials, and HTTPS downgrade redirects', async () => {
    const { context } = await createContext();
    const noFetch = vi.fn<typeof fetch>();
    await expect(
      downloadRemoteImageAsset(remoteRequest(context, noFetch, { url: 'file:///C:/secret.png' })),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_PROTOCOL' });
    await expect(
      downloadRemoteImageAsset(
        remoteRequest(context, noFetch, { url: 'https://user:pass@example.test/image.png' }),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });

    const downgrade = vi.fn<typeof fetch>(async () =>
      new Response(null, { status: 302, headers: { location: 'http://example.test/image.png' } }),
    );
    await expect(
      downloadRemoteImageAsset(remoteRequest(context, downgrade)),
    ).rejects.toMatchObject({ code: 'UNSAFE_REDIRECT' });
  });

  it('rejects redirect loops at the configured boundary', async () => {
    const { context } = await createContext();
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(null, { status: 302, headers: { location: '/again' } }),
    );
    await expect(
      downloadRemoteImageAsset(remoteRequest(context, fetchImpl, { maxRedirects: 1 })),
    ).rejects.toMatchObject({ code: 'TOO_MANY_REDIRECTS' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('rejects non-image responses and unsuccessful HTTP statuses', async () => {
    const { context } = await createContext();
    const textFetch = vi.fn<typeof fetch>(async () =>
      new Response('not image', { headers: { 'content-type': 'text/html' } }),
    );
    await expect(
      downloadRemoteImageAsset(remoteRequest(context, textFetch)),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });

    const failedFetch = vi.fn<typeof fetch>(async () =>
      new Response(null, { status: 404, headers: { 'content-type': 'image/png' } }),
    );
    await expect(
      downloadRemoteImageAsset(remoteRequest(context, failedFetch)),
    ).rejects.toMatchObject({ code: 'DOWNLOAD_FAILED' });
  });

  it('rejects an empty successful response', async () => {
    const { context } = await createContext();
    const fetchImpl = vi.fn<typeof fetch>(async () => imageResponse(new Uint8Array()));
    await expect(
      downloadRemoteImageAsset(remoteRequest(context, fetchImpl)),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('rejects an oversized declared Content-Length before reading the body', async () => {
    const { context } = await createContext();
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      imageResponse(new Uint8Array([1]), { headers: { 'content-length': '100' } }),
    );
    await expect(
      downloadRemoteImageAsset(remoteRequest(context, fetchImpl, { maxBytes: 10 })),
    ).rejects.toMatchObject({ code: 'DOWNLOAD_TOO_LARGE' });
  });

  it('enforces the size boundary while streaming an undeclared body', async () => {
    const { context } = await createContext();
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      imageResponse(new Uint8Array([1, 2, 3, 4, 5])),
    );
    await expect(
      downloadRemoteImageAsset(remoteRequest(context, fetchImpl, { maxBytes: 4 })),
    ).rejects.toMatchObject({ code: 'DOWNLOAD_TOO_LARGE' });
  });

  it('times out a stalled request with an actionable error', async () => {
    const { context } = await createContext();
    const fetchImpl = vi.fn<typeof fetch>(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
            { once: true },
          );
        }),
    );
    await expect(
      downloadRemoteImageAsset(remoteRequest(context, fetchImpl, { timeoutMs: 5 })),
    ).rejects.toMatchObject({ code: 'DOWNLOAD_TIMEOUT' });
  });

  it('honors caller cancellation before any network request', async () => {
    const { context } = await createContext();
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(
      downloadRemoteImageAsset(remoteRequest(context, fetchImpl, { signal: controller.signal })),
    ).rejects.toMatchObject({ code: 'DOWNLOAD_CANCELLED' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('does not overwrite an existing remote asset unless overwrite is explicit', async () => {
    const { context, documentPath } = await createContext();
    const directory = path.join(path.dirname(documentPath), 'assets');
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'photo.png'), 'existing');
    const fetchImpl = vi.fn<typeof fetch>(async () => imageResponse(new Uint8Array([7])));
    const result = await downloadRemoteImageAsset(remoteRequest(context, fetchImpl));
    expect(result.filename).toBe('photo (1).png');
    expect(await readFile(path.join(directory, 'photo.png'), 'utf8')).toBe('existing');
  });
});
