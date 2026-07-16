import { access, mkdir, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  WorkspaceSearchError,
  WorkspaceSearchService,
  compileWorkspaceGlob,
  searchWorkspaceAdvanced,
  type WorkspaceReplacePreview,
  type WorkspaceSearchRequest,
} from '../../electron/main/workspace-search';

const temporaryDirectories: string[] = [];

async function temporaryWorkspace(): Promise<string> {
  const root = await import('node:fs/promises').then(({ mkdtemp }) =>
    mkdtemp(path.join(tmpdir(), 'markora-workspace-search-')),
  );
  temporaryDirectories.push(root);
  return root;
}

async function writeWorkspaceFile(root: string, relativePath: string, content: string | Uint8Array) {
  const filePath = path.join(root, ...relativePath.split('/'));
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
  return filePath;
}

function request(root: string, overrides: Partial<WorkspaceSearchRequest> = {}): WorkspaceSearchRequest {
  return {
    workspaceRoot: root,
    query: 'alpha',
    ...overrides,
  };
}

async function createBasicWorkspace(): Promise<string> {
  const root = await temporaryWorkspace();
  await writeWorkspaceFile(root, 'README.md', 'Alpha beta ALPHA\nSecond alpha.\n');
  await writeWorkspaceFile(root, 'notes/one.md', '# One\n\nalpha in notes\n');
  await writeWorkspaceFile(root, 'notes/two.markdown', 'No match here.\n');
  return root;
}

async function confirmPreview(
  service: WorkspaceSearchService,
  preview: WorkspaceReplacePreview,
  signal?: AbortSignal,
) {
  return service.applyReplacePreview({
    previewToken: preview.previewToken,
    confirmationToken: preview.confirmationToken,
    confirmed: true,
    createBackups: true,
    signal,
  });
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('advanced workspace search', () => {
  it('finds every case-insensitive literal occurrence and groups results by file', async () => {
    const root = await createBasicWorkspace();
    const result = await searchWorkspaceAdvanced(request(root));

    expect(result).toMatchObject({
      matchCount: 4,
      matchedFileCount: 2,
      discoveredFileCount: 3,
      searchedFileCount: 3,
      truncated: false,
      failures: [],
    });
    expect(result.files.map((file) => file.relativePath)).toEqual(['notes/one.md', 'README.md']);
    const readme = result.files.find((file) => file.relativePath === 'README.md')!;
    expect(readme.matches.map(({ line, column, matchedText }) => ({ line, column, matchedText }))).toEqual([
      { line: 1, column: 1, matchedText: 'Alpha' },
      { line: 1, column: 12, matchedText: 'ALPHA' },
      { line: 2, column: 8, matchedText: 'alpha' },
    ]);
    expect(readme.matches[0]).toMatchObject({
      kind: 'content',
      preview: 'Alpha beta ALPHA',
      previewMatchStart: 0,
      previewMatchLength: 5,
    });
  });

  it('supports case-sensitive literal search', async () => {
    const root = await createBasicWorkspace();
    const result = await searchWorkspaceAdvanced(
      request(root, { query: 'Alpha', caseSensitive: true }),
    );
    expect(result.matchCount).toBe(1);
    expect(result.files[0]?.matches[0]?.matchedText).toBe('Alpha');
  });

  it('uses Unicode-aware whole-word boundaries', async () => {
    const root = await temporaryWorkspace();
    await writeWorkspaceFile(root, 'words.md', 'cat scatter cat 猫cat cat_ cat- cat');
    const result = await searchWorkspaceAdvanced(
      request(root, { query: 'cat', wholeWord: true, caseSensitive: true }),
    );
    expect(result.files[0]?.matches.map((match) => match.column)).toEqual([1, 13, 27, 32]);
  });

  it('supports regular expressions and reports exact match spans', async () => {
    const root = await temporaryWorkspace();
    await writeWorkspaceFile(root, 'regex.md', 'issue-12 issue-987 none');
    const result = await searchWorkspaceAdvanced(
      request(root, { query: 'issue-(\\d+)', regex: true, caseSensitive: true }),
    );
    expect(result.matchCount).toBe(2);
    expect(result.files[0]?.matches).toEqual([
      expect.objectContaining({ matchedText: 'issue-12', column: 1, endColumn: 9 }),
      expect.objectContaining({ matchedText: 'issue-987', column: 10, endColumn: 19 }),
    ]);
  });

  it('rejects invalid regular expressions with a typed error', async () => {
    const root = await temporaryWorkspace();
    await expect(
      searchWorkspaceAdvanced(request(root, { query: '[broken', regex: true })),
    ).rejects.toMatchObject({ code: 'INVALID_PATTERN' });
  });

  it('terminates predictably for zero-width regular expressions', async () => {
    const root = await temporaryWorkspace();
    await writeWorkspaceFile(root, 'zero.md', 'one two');
    const result = await searchWorkspaceAdvanced(
      request(root, { query: '(?=o)', regex: true, caseSensitive: true }),
    );
    expect(result.matchCount).toBe(2);
    expect(result.files[0]?.matches.map((match) => match.startOffset)).toEqual([0, 6]);
  });

  it('searches filenames without reading their content', async () => {
    const root = await temporaryWorkspace();
    await writeWorkspaceFile(root, 'Alpha Notes.md', new Uint8Array([0, 1, 2]));
    await writeWorkspaceFile(root, 'other.md', 'alpha');
    const result = await searchWorkspaceAdvanced(request(root, { scope: 'filename' }));
    expect(result.matchCount).toBe(1);
    expect(result.failures).toEqual([]);
    expect(result.files[0]).toMatchObject({ relativePath: 'Alpha Notes.md' });
    expect(result.files[0]?.matches[0]).toMatchObject({ kind: 'filename', line: 1, column: 1 });
  });

  it('combines filename and content matches in both scope', async () => {
    const root = await temporaryWorkspace();
    await writeWorkspaceFile(root, 'alpha.md', 'alpha alpha');
    const result = await searchWorkspaceAdvanced(request(root, { scope: 'both' }));
    expect(result.matchCount).toBe(3);
    expect(result.files[0]?.matches.map((match) => match.kind)).toEqual([
      'filename',
      'content',
      'content',
    ]);
  });

  it('supports include globs for non-Markdown text files', async () => {
    const root = await temporaryWorkspace();
    await writeWorkspaceFile(root, 'notes.md', 'alpha');
    await writeWorkspaceFile(root, 'data/info.txt', 'alpha');
    const result = await searchWorkspaceAdvanced(
      request(root, { includeGlobs: ['**/*.txt'] }),
    );
    expect(result.files.map((file) => file.relativePath)).toEqual(['data/info.txt']);
  });

  it('supports exclude glob patterns without traversing excluded directories', async () => {
    const root = await temporaryWorkspace();
    await writeWorkspaceFile(root, 'keep.md', 'alpha');
    await writeWorkspaceFile(root, 'drafts/skip.md', 'alpha');
    await writeWorkspaceFile(root, 'archive/skip.md', 'alpha');
    const result = await searchWorkspaceAdvanced(
      request(root, { excludeGlobs: ['drafts/**', '**/archive/**'] }),
    );
    expect(result.files.map((file) => file.relativePath)).toEqual(['keep.md']);
  });

  it.each([
    '.git',
    'node_modules',
    'dist',
    'release',
    'build',
    'out',
    '.cache',
    'cache',
    '.markora',
  ])('always ignores the default %s directory', async (ignoredDirectory) => {
    const root = await temporaryWorkspace();
    await writeWorkspaceFile(root, 'keep.md', 'alpha');
    await writeWorkspaceFile(root, `${ignoredDirectory}/skip.md`, 'alpha');
    const result = await searchWorkspaceAdvanced(request(root));
    expect(result.files.map((file) => file.relativePath)).toEqual(['keep.md']);
  });

  it('supports custom ignored directory names at any depth', async () => {
    const root = await temporaryWorkspace();
    await writeWorkspaceFile(root, 'keep.md', 'alpha');
    await writeWorkspaceFile(root, 'notes/generated/skip.md', 'alpha');
    const result = await searchWorkspaceAdvanced(
      request(root, { ignoredDirectories: ['generated'] }),
    );
    expect(result.files.map((file) => file.relativePath)).toEqual(['keep.md']);
  });

  it('honors root .gitignore patterns and practical negation', async () => {
    const root = await temporaryWorkspace();
    await writeWorkspaceFile(root, '.gitignore', 'ignored.md\nprivate/\n*.tmp\n!keep.tmp\n');
    await writeWorkspaceFile(root, 'ignored.md', 'alpha');
    await writeWorkspaceFile(root, 'private/secret.md', 'alpha');
    await writeWorkspaceFile(root, 'drop.tmp', 'alpha');
    await writeWorkspaceFile(root, 'keep.tmp', 'alpha');
    const result = await searchWorkspaceAdvanced(
      request(root, { includeGlobs: ['**/*'] }),
    );
    expect(result.files.map((file) => file.relativePath)).toEqual(['keep.tmp']);
  });

  it('can explicitly disable .gitignore awareness', async () => {
    const root = await temporaryWorkspace();
    await writeWorkspaceFile(root, '.gitignore', 'ignored.md\n');
    await writeWorkspaceFile(root, 'ignored.md', 'alpha');
    const result = await searchWorkspaceAdvanced(request(root, { respectGitignore: false }));
    expect(result.files.map((file) => file.relativePath)).toEqual(['ignored.md']);
  });

  it('reports binary, invalid UTF-8, and oversized files individually', async () => {
    const root = await temporaryWorkspace();
    await writeWorkspaceFile(root, 'binary.md', new Uint8Array([97, 0, 108, 112, 104, 97]));
    await writeWorkspaceFile(root, 'invalid.md', new Uint8Array([0xc3, 0x28]));
    await writeWorkspaceFile(root, 'large.md', 'alpha'.repeat(20));
    const result = await searchWorkspaceAdvanced(request(root, { maxFileBytes: 20 }));
    expect(result.matchCount).toBe(0);
    expect(result.failures.map((failure) => failure.code).sort()).toEqual([
      'BINARY_FILE',
      'FILE_TOO_LARGE',
      'INVALID_UTF8',
    ]);
  });

  it('bounds matching-line previews while retaining highlight coordinates', async () => {
    const root = await temporaryWorkspace();
    await writeWorkspaceFile(root, 'long.md', `${'x'.repeat(200)}alpha${'y'.repeat(200)}`);
    const result = await searchWorkspaceAdvanced(request(root));
    const match = result.files[0]?.matches[0];
    expect(match?.preview.length).toBeLessThanOrEqual(240);
    expect(match?.preview.slice(match.previewMatchStart, match.previewMatchStart + 5)).toBe('alpha');
    expect(match?.previewStartColumn).toBeGreaterThan(1);
  });

  it('preserves exact CRLF offsets and line positions', async () => {
    const root = await temporaryWorkspace();
    await writeWorkspaceFile(root, 'crlf.md', 'first\r\nalpha\r\nlast');
    const result = await searchWorkspaceAdvanced(request(root));
    expect(result.files[0]?.matches[0]).toMatchObject({
      line: 2,
      column: 1,
      startOffset: 7,
      endOffset: 12,
      preview: 'alpha',
    });
  });

  it('preserves Unicode text and stable match fingerprints', async () => {
    const root = await temporaryWorkspace();
    await writeWorkspaceFile(root, 'unicode.md', '文档 alpha 🚀 alpha');
    const first = await searchWorkspaceAdvanced(request(root));
    const second = await searchWorkspaceAdvanced(request(root));
    expect(first.files[0]?.matches.map((match) => match.id)).toEqual(
      second.files[0]?.matches.map((match) => match.id),
    );
    expect(first.files[0]?.matches[0]?.column).toBe(4);
  });

  it('caps match results without exceeding the requested boundary under concurrency', async () => {
    const root = await temporaryWorkspace();
    await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        writeWorkspaceFile(root, `file-${index}.md`, 'alpha alpha alpha'),
      ),
    );
    const result = await searchWorkspaceAdvanced(
      request(root, { maxMatches: 7, concurrency: 8 }),
    );
    expect(result.matchCount).toBe(7);
    expect(result.files.flatMap((file) => file.matches)).toHaveLength(7);
    expect(result.truncated).toBe(true);
  });

  it('caps enumerated files but still searches the capped candidate set', async () => {
    const root = await temporaryWorkspace();
    await Promise.all(
      Array.from({ length: 5 }, (_, index) => writeWorkspaceFile(root, `file-${index}.md`, 'alpha')),
    );
    const result = await searchWorkspaceAdvanced(request(root, { maxFiles: 2 }));
    expect(result.discoveredFileCount).toBe(2);
    expect(result.searchedFileCount).toBe(2);
    expect(result.matchCount).toBe(2);
    expect(result.truncated).toBe(true);
  });

  it('reports enumeration, search, and completion progress', async () => {
    const root = await createBasicWorkspace();
    const progress = vi.fn();
    await searchWorkspaceAdvanced(request(root, { onProgress: progress, concurrency: 2 }));
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ phase: 'enumerating' }));
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ phase: 'searching' }));
    expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'complete' }));
  });

  it('honors AbortSignal cancellation', async () => {
    const root = await createBasicWorkspace();
    const controller = new AbortController();
    controller.abort();
    await expect(
      searchWorkspaceAdvanced(request(root, { signal: controller.signal })),
    ).rejects.toMatchObject({ code: 'CANCELLED' });
  });

  it('can be cancelled from a progress callback during enumeration', async () => {
    const root = await createBasicWorkspace();
    const controller = new AbortController();
    await expect(
      searchWorkspaceAdvanced(
        request(root, {
          signal: controller.signal,
          onProgress: ({ phase }) => {
            if (phase === 'enumerating') controller.abort();
          },
        }),
      ),
    ).rejects.toMatchObject({ code: 'CANCELLED' });
  });

  it('compiles common glob forms for root and nested paths', () => {
    expect(compileWorkspaceGlob('**/*.md').test('file.md')).toBe(true);
    expect(compileWorkspaceGlob('**/*.md').test('notes/file.md')).toBe(true);
    expect(compileWorkspaceGlob('notes/?.md').test('notes/a.md')).toBe(true);
    expect(compileWorkspaceGlob('notes/[ab].md').test('notes/b.md')).toBe(true);
    expect(compileWorkspaceGlob('notes/[ab].md').test('notes/c.md')).toBe(false);
  });

  it('validates workspace, query, globs, limits, and custom ignores', async () => {
    const root = await temporaryWorkspace();
    await expect(searchWorkspaceAdvanced(request(root, { query: '' }))).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
    await expect(
      searchWorkspaceAdvanced(request(root, { includeGlobs: [] })),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(
      searchWorkspaceAdvanced(request(root, { concurrency: 0 })),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(
      searchWorkspaceAdvanced(request(root, { ignoredDirectories: ['../outside'] })),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(
      searchWorkspaceAdvanced(request(path.join(root, 'missing'))),
    ).rejects.toMatchObject({ code: 'INVALID_WORKSPACE' });
  });
});

describe('mandatory workspace replacement preview and confirmation', () => {
  it('creates a complete preview without mutating files', async () => {
    const root = await createBasicWorkspace();
    const service = new WorkspaceSearchService();
    const before = await readFile(path.join(root, 'README.md'), 'utf8');
    const preview = await service.createReplacePreview({
      search: request(root),
      replacement: 'omega',
    });
    expect(preview).toMatchObject({
      workspaceRoot: root,
      selectedFileCount: 2,
      selectedMatchCount: 4,
      totalContentMatchCount: 4,
    });
    expect(preview.previewToken).toMatch(/^[0-9a-f-]{36}$/u);
    expect(preview.confirmationToken).toMatch(/^[0-9a-f-]{36}$/u);
    expect(preview.files.flatMap((file) => file.matches)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ matchedText: 'Alpha', replacementText: 'omega', selected: true }),
      ]),
    );
    expect(await readFile(path.join(root, 'README.md'), 'utf8')).toBe(before);
  });

  it('treats dollar replacement syntax literally for literal search', async () => {
    const root = await createBasicWorkspace();
    const preview = await new WorkspaceSearchService().createReplacePreview({
      search: request(root),
      replacement: '$1 $$ $&',
    });
    expect(preview.files[0]?.matches[0]?.replacementText).toBe('$1 $$ $&');
  });

  it('previews numbered and named regular-expression capture replacement', async () => {
    const root = await temporaryWorkspace();
    await writeWorkspaceFile(root, 'capture.md', 'alpha-12 beta-9');
    const preview = await new WorkspaceSearchService().createReplacePreview({
      search: request(root, {
        query: '(?<word>[a-z]+)-(\\d+)',
        regex: true,
        caseSensitive: true,
      }),
      replacement: '$<word>[$2]-$&-$$',
    });
    expect(preview.files[0]?.matches.map((match) => match.replacementText)).toEqual([
      'alpha[12]-alpha-12-$',
      'beta[9]-beta-9-$',
    ]);
  });

  it('supports per-file, per-result, and explicit exclusion selection', async () => {
    const root = await createBasicWorkspace();
    const service = new WorkspaceSearchService();
    const search = await service.search(request(root));
    const readme = search.files.find((file) => file.relativePath === 'README.md')!;
    const firstReadmeMatch = readme.matches[0]!;
    const preview = await service.createReplacePreview({
      search: request(root),
      replacement: 'omega',
      selection: {
        includeFileIds: [readme.id],
        excludeMatchIds: [firstReadmeMatch.id],
      },
    });
    expect(preview.selectedFileCount).toBe(1);
    expect(preview.selectedMatchCount).toBe(2);
    expect(
      preview.files
        .find((file) => file.id === readme.id)
        ?.matches.find((match) => match.id === firstReadmeMatch.id)?.selected,
    ).toBe(false);

    const oneMatch = await service.createReplacePreview({
      search: request(root),
      replacement: 'omega',
      selection: { includeMatchIds: [firstReadmeMatch.id] },
    });
    expect(oneMatch.selectedMatchCount).toBe(1);
  });

  it('rejects unknown and empty selections', async () => {
    const root = await createBasicWorkspace();
    const service = new WorkspaceSearchService();
    await expect(
      service.createReplacePreview({
        search: request(root),
        replacement: 'omega',
        selection: { includeMatchIds: ['unknown'] },
      }),
    ).rejects.toMatchObject({ code: 'UNKNOWN_SELECTION' });
    const search = await service.search(request(root));
    await expect(
      service.createReplacePreview({
        search: request(root),
        replacement: 'omega',
        selection: {
          excludeMatchIds: search.files.flatMap((file) => file.matches.map((match) => match.id)),
        },
      }),
    ).rejects.toMatchObject({ code: 'NO_MATCHES' });
  });

  it('rejects a preview request when content has no matches', async () => {
    const root = await createBasicWorkspace();
    await expect(
      new WorkspaceSearchService().createReplacePreview({
        search: request(root, { query: 'absent' }),
        replacement: 'omega',
      }),
    ).rejects.toMatchObject({ code: 'NO_MATCHES' });
  });

  it('makes direct writes impossible without a known preview token', async () => {
    const service = new WorkspaceSearchService();
    await expect(
      service.applyReplacePreview({
        previewToken: 'not-a-preview',
        confirmationToken: 'not-confirmed',
        confirmed: true,
        createBackups: true,
      }),
    ).rejects.toMatchObject({ code: 'PREVIEW_REQUIRED' });
  });

  it('requires both the exact confirmation token and an explicit confirmation flag', async () => {
    const root = await createBasicWorkspace();
    const service = new WorkspaceSearchService();
    const preview = await service.createReplacePreview({
      search: request(root),
      replacement: 'omega',
    });
    await expect(
      service.applyReplacePreview({
        previewToken: preview.previewToken,
        confirmationToken: preview.confirmationToken,
        confirmed: false,
        createBackups: true,
      }),
    ).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
    await expect(
      service.applyReplacePreview({
        previewToken: preview.previewToken,
        confirmationToken: 'wrong-token',
        confirmed: true,
        createBackups: true,
      }),
    ).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
    await expect(confirmPreview(service, preview)).resolves.toMatchObject({ replacedFileCount: 2 });
  });

  it('refuses to replace without mandatory backups', async () => {
    const root = await createBasicWorkspace();
    const service = new WorkspaceSearchService();
    const preview = await service.createReplacePreview({
      search: request(root),
      replacement: 'omega',
    });
    await expect(
      service.applyReplacePreview({
        previewToken: preview.previewToken,
        confirmationToken: preview.confirmationToken,
        confirmed: true,
        createBackups: false,
      }),
    ).rejects.toMatchObject({ code: 'BACKUP_REQUIRED' });
    await expect(confirmPreview(service, preview)).resolves.toMatchObject({ replacedMatchCount: 4 });
  });

  it('backs up originals and atomically applies all selected replacements', async () => {
    const root = await createBasicWorkspace();
    const service = new WorkspaceSearchService();
    const originalReadme = await readFile(path.join(root, 'README.md'), 'utf8');
    const originalNote = await readFile(path.join(root, 'notes/one.md'), 'utf8');
    const preview = await service.createReplacePreview({
      search: request(root),
      replacement: 'omega',
    });
    const result = await confirmPreview(service, preview);
    expect(result).toMatchObject({
      replacedFileCount: 2,
      replacedMatchCount: 4,
      failedFileCount: 0,
      cancelled: false,
    });
    expect(await readFile(path.join(root, 'README.md'), 'utf8')).toBe(
      'omega beta omega\nSecond omega.\n',
    );
    expect(await readFile(path.join(root, 'notes/one.md'), 'utf8')).toContain('omega in notes');
    expect(await readFile(path.join(result.backupRoot, 'README.md'), 'utf8')).toBe(originalReadme);
    expect(await readFile(path.join(result.backupRoot, 'notes', 'one.md'), 'utf8')).toBe(originalNote);
  });

  it('preserves CRLF line endings during selected replacement', async () => {
    const root = await temporaryWorkspace();
    await writeWorkspaceFile(root, 'crlf.md', 'alpha\r\nline alpha\r\n');
    const service = new WorkspaceSearchService();
    const preview = await service.createReplacePreview({
      search: request(root),
      replacement: 'omega',
    });
    await confirmPreview(service, preview);
    expect(await readFile(path.join(root, 'crlf.md'), 'utf8')).toBe('omega\r\nline omega\r\n');
  });

  it('preserves a UTF-8 byte-order mark during replacement', async () => {
    const root = await temporaryWorkspace();
    const file = await writeWorkspaceFile(
      root,
      'bom.md',
      new Uint8Array([0xef, 0xbb, 0xbf, ...Buffer.from('alpha\r\n', 'utf8')]),
    );
    const service = new WorkspaceSearchService();
    const preview = await service.createReplacePreview({
      search: request(root),
      replacement: 'omega',
    });
    expect(preview.files[0]?.matches[0]?.startOffset).toBe(1);
    await confirmPreview(service, preview);
    const bytes = await readFile(file);
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(bytes.subarray(3).toString('utf8')).toBe('omega\r\n');
  });

  it('consumes a preview token so a bulk replacement cannot be replayed', async () => {
    const root = await createBasicWorkspace();
    const service = new WorkspaceSearchService();
    const preview = await service.createReplacePreview({
      search: request(root),
      replacement: 'omega',
    });
    await confirmPreview(service, preview);
    await expect(confirmPreview(service, preview)).rejects.toMatchObject({ code: 'PREVIEW_REQUIRED' });
  });

  it('refuses stale files and never overwrites changes made after preview', async () => {
    const root = await createBasicWorkspace();
    const service = new WorkspaceSearchService();
    const preview = await service.createReplacePreview({
      search: request(root),
      replacement: 'omega',
      selection: {
        includeFileIds: [
          (await service.search(request(root))).files.find(
            (file) => file.relativePath === 'README.md',
          )!.id,
        ],
      },
    });
    await writeFile(path.join(root, 'README.md'), 'newer disk version alpha\n');
    const result = await confirmPreview(service, preview);
    expect(result).toMatchObject({ replacedFileCount: 0, failedFileCount: 1 });
    expect(result.files[0]).toMatchObject({ status: 'failed', code: 'FILE_CHANGED' });
    expect(await readFile(path.join(root, 'README.md'), 'utf8')).toBe('newer disk version alpha\n');
  });

  it('reports per-file failures while successfully replacing unaffected files', async () => {
    const root = await createBasicWorkspace();
    const service = new WorkspaceSearchService();
    const preview = await service.createReplacePreview({
      search: request(root),
      replacement: 'omega',
    });
    await unlink(path.join(root, 'README.md'));
    const result = await confirmPreview(service, preview);
    expect(result).toMatchObject({ replacedFileCount: 1, failedFileCount: 1, replacedMatchCount: 1 });
    expect(result.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ relativePath: 'README.md', status: 'failed' }),
        expect.objectContaining({ relativePath: 'notes/one.md', status: 'replaced' }),
      ]),
    );
  });

  it('expires previews and requires a fresh review', async () => {
    const root = await createBasicWorkspace();
    let now = 1_000;
    const service = new WorkspaceSearchService({ previewTtlMs: 10, now: () => now });
    const preview = await service.createReplacePreview({
      search: request(root),
      replacement: 'omega',
    });
    now = 1_011;
    await expect(confirmPreview(service, preview)).rejects.toMatchObject({ code: 'PREVIEW_EXPIRED' });
  });

  it('honors cancellation before writes and reports every skipped selected file', async () => {
    const root = await createBasicWorkspace();
    const service = new WorkspaceSearchService();
    const preview = await service.createReplacePreview({
      search: request(root),
      replacement: 'omega',
    });
    const controller = new AbortController();
    controller.abort();
    const result = await confirmPreview(service, preview, controller.signal);
    expect(result).toMatchObject({
      replacedFileCount: 0,
      failedFileCount: 0,
      cancelled: true,
    });
    expect(result.files.every((file) => file.status === 'cancelled')).toBe(true);
    expect(await readFile(path.join(root, 'README.md'), 'utf8')).toContain('Alpha');
  });

  it('can discard a preview before confirmation', async () => {
    const root = await createBasicWorkspace();
    const service = new WorkspaceSearchService();
    const preview = await service.createReplacePreview({
      search: request(root),
      replacement: 'omega',
    });
    expect(service.discardReplacePreview(preview.previewToken)).toBe(true);
    expect(service.discardReplacePreview(preview.previewToken)).toBe(false);
    await expect(confirmPreview(service, preview)).rejects.toMatchObject({ code: 'PREVIEW_REQUIRED' });
  });

  it('reports backup creation failure and leaves the source untouched', async () => {
    const root = await createBasicWorkspace();
    const service = new WorkspaceSearchService();
    const search = await service.search(request(root));
    const readme = search.files.find((file) => file.relativePath === 'README.md')!;
    const preview = await service.createReplacePreview({
      search: request(root),
      replacement: 'omega',
      selection: { includeFileIds: [readme.id] },
    });
    await writeFile(path.join(root, '.markora'), 'blocks backup directory');
    const original = await readFile(path.join(root, 'README.md'), 'utf8');
    const result = await confirmPreview(service, preview);
    expect(result.files[0]).toMatchObject({ status: 'failed', code: 'BACKUP_FAILED' });
    expect(await readFile(path.join(root, 'README.md'), 'utf8')).toBe(original);
  });

  it('applies only an explicitly selected individual result', async () => {
    const root = await createBasicWorkspace();
    const service = new WorkspaceSearchService();
    const search = await service.search(request(root));
    const target = search.files.find((file) => file.relativePath === 'README.md')!.matches[1]!;
    const preview = await service.createReplacePreview({
      search: request(root),
      replacement: 'omega',
      selection: { includeMatchIds: [target.id] },
    });
    const result = await confirmPreview(service, preview);
    expect(result.replacedMatchCount).toBe(1);
    expect(await readFile(path.join(root, 'README.md'), 'utf8')).toBe(
      'Alpha beta omega\nSecond alpha.\n',
    );
    expect(await readFile(path.join(root, 'notes/one.md'), 'utf8')).toContain('alpha in notes');
  });

  it('automatically ignores generated backup content in future searches', async () => {
    const root = await createBasicWorkspace();
    const service = new WorkspaceSearchService();
    const preview = await service.createReplacePreview({
      search: request(root),
      replacement: 'omega',
    });
    const replaced = await confirmPreview(service, preview);
    await access(replaced.backupRoot);
    const future = await service.search(request(root));
    expect(future.files.every((file) => !file.relativePath.startsWith('.markora/'))).toBe(true);
    expect(future.matchCount).toBe(0);
  });

  it('uses bounded pending-preview retention', async () => {
    const root = await createBasicWorkspace();
    const service = new WorkspaceSearchService({ maxPendingPreviews: 1 });
    const first = await service.createReplacePreview({
      search: request(root),
      replacement: 'one',
    });
    const second = await service.createReplacePreview({
      search: request(root),
      replacement: 'two',
    });
    await expect(confirmPreview(service, first)).rejects.toMatchObject({ code: 'PREVIEW_REQUIRED' });
    await expect(confirmPreview(service, second)).resolves.toMatchObject({ replacedMatchCount: 4 });
  });

  it('exposes serializable typed errors for IPC failure reporting', () => {
    const error = new WorkspaceSearchError('FILE_CHANGED', 'File changed.', {
      path: 'C:\\workspace\\note.md',
    });
    expect(error.toJSON()).toEqual({
      name: 'WorkspaceSearchError',
      code: 'FILE_CHANGED',
      message: 'File changed.',
      path: 'C:\\workspace\\note.md',
      recoverable: true,
    });
  });

  it('keeps original file metadata mode where the platform exposes it', async () => {
    const root = await temporaryWorkspace();
    const file = await writeWorkspaceFile(root, 'mode.md', 'alpha');
    const originalMode = (await stat(file)).mode;
    const service = new WorkspaceSearchService();
    const preview = await service.createReplacePreview({
      search: request(root),
      replacement: 'omega',
    });
    await confirmPreview(service, preview);
    expect((await stat(file)).mode).toBe(originalMode);
  });
});
