import { EventEmitter } from 'node:events';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import {
  PANDOC_EXPORT_FORMATS,
  PANDOC_IMPORT_FORMATS,
  PandocError,
  buildPandocExportArguments,
  buildPandocImportArguments,
  detectPandoc,
  listPandocCandidates,
  parsePandocVersion,
  probePandoc,
  runPandocConversion,
  validateAbsolutePath,
  validatePandocExecutablePath,
  type PandocChildProcess,
  type PandocDependencies,
  type PandocExportFormat,
  type PandocImportFormat,
  type PandocSpawn,
  type PandocSpawnOptions,
} from '../../electron/main/pandoc';

interface MockResponse {
  readonly stdout?: string | Buffer;
  readonly stderr?: string | Buffer;
  readonly exitCode?: number | null;
  readonly signal?: 'SIGTERM' | null;
  readonly error?: Error;
  readonly hang?: boolean;
}

interface SpawnCall {
  readonly executable: string;
  readonly args: readonly string[];
  readonly options: PandocSpawnOptions;
}

class MockChild extends EventEmitter implements PandocChildProcess {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly kill = vi.fn((signal: 'SIGTERM' = 'SIGTERM') => {
    queueMicrotask(() => this.emit('close', null, signal));
    return true;
  });
}

function spawnHarness(responses: readonly MockResponse[]) {
  const pending = [...responses];
  const calls: SpawnCall[] = [];
  const children: MockChild[] = [];
  const spawn: PandocSpawn = (executable, args, options) => {
    const response = pending.shift();
    if (!response) throw new Error('The test did not configure a process response.');
    const child = new MockChild();
    calls.push({ executable, args: [...args], options });
    children.push(child);
    queueMicrotask(() => {
      if (response.error) {
        child.emit('error', response.error);
        return;
      }
      if (response.hang) return;
      if (response.stdout !== undefined) child.stdout.write(response.stdout);
      if (response.stderr !== undefined) child.stderr.write(response.stderr);
      child.emit('close', response.exitCode ?? 0, response.signal ?? null);
    });
    return child;
  };
  return { spawn, calls, children };
}

const fakeStat = (filePath: string) => {
  const extension = path.win32.extname(filePath);
  return Promise.resolve({
    isFile: () => extension.length > 0,
    isDirectory: () => extension.length === 0,
  });
};

function dependencies(
  spawn: PandocSpawn,
  overrides: Partial<PandocDependencies> = {},
): Partial<PandocDependencies> {
  return {
    spawn,
    stat: fakeStat,
    access: () => Promise.resolve(),
    env: {},
    platform: 'win32',
    ...overrides,
  };
}

function expectPandocError(code: PandocError['code']) {
  return expect.objectContaining({ name: 'PandocError', code });
}

const exportExtensions: Record<PandocExportFormat, string> = {
  docx: 'docx',
  odt: 'odt',
  rtf: 'rtf',
  epub: 'epub',
  latex: 'tex',
  mediawiki: 'mediawiki',
  plain: 'txt',
};

const importExtensions: Record<PandocImportFormat, string> = {
  docx: 'docx',
  odt: 'odt',
  rtf: 'rtf',
  html: 'html',
  latex: 'tex',
};

describe('Pandoc path and argument validation', () => {
  it.each(PANDOC_EXPORT_FORMATS)('builds a safe %s export argument array', (format) => {
    const args = buildPandocExportArguments({
      inputPath: 'C:\\Documents\\draft.md',
      outputPath: `C:\\Exports\\draft.${exportExtensions[format]}`,
      format,
    });

    expect(args).toEqual([
      '--from',
      'gfm',
      '--to',
      format,
      '--output',
      `C:\\Exports\\draft.${exportExtensions[format]}`,
      '--standalone',
      '--',
      'C:\\Documents\\draft.md',
    ]);
  });

  it.each(PANDOC_IMPORT_FORMATS)('builds a safe %s import argument array', (format) => {
    const args = buildPandocImportArguments({
      inputPath: `C:\\Imports\\source.${importExtensions[format]}`,
      outputPath: 'C:\\Documents\\source.md',
      format,
    });

    expect(args).toEqual([
      '--from',
      format,
      '--to',
      'gfm',
      '--wrap',
      'none',
      '--output',
      'C:\\Documents\\source.md',
      '--',
      `C:\\Imports\\source.${importExtensions[format]}`,
    ]);
  });

  it('emits only allowlisted options and keeps values in separate argv entries', () => {
    const args = buildPandocExportArguments({
      inputPath: 'C:\\Documents\\draft & whoami.md',
      outputPath: 'C:\\Exports\\draft & calc.docx',
      format: 'docx',
      options: {
        tableOfContents: true,
        numberSections: true,
        resourcePath: 'C:\\Documents\\assets',
        referenceDocument: 'C:\\Templates\\company.docx',
        metadata: { title: '--version & calc', author: 'A; whoami' },
      },
    });

    expect(args).toContain('C:\\Documents\\draft & whoami.md');
    expect(args).toContain('C:\\Exports\\draft & calc.docx');
    expect(args).toContain('title=--version & calc');
    expect(args).toContain('author=A; whoami');
    expect(args.at(-2)).toBe('--');
    expect(args.at(-1)).toBe('C:\\Documents\\draft & whoami.md');
  });

  it.each([
    () => validateAbsolutePath('relative\\document.md'),
    () => validateAbsolutePath('C:\\Documents\\bad\0name.md'),
    () => validateAbsolutePath('\\\\.\\PhysicalDrive0'),
    () => validateAbsolutePath('\\\\?\\GLOBALROOT\\Device\\HarddiskVolume1'),
    () => validatePandocExecutablePath('C:\\Tools\\pandoc.cmd', 'win32'),
    () =>
      buildPandocExportArguments({
        inputPath: 'C:\\Documents\\draft.md',
        outputPath: 'C:\\Exports\\draft.pdf',
        format: 'docx',
      }),
    () =>
      buildPandocImportArguments({
        inputPath: 'C:\\Imports\\source.docx',
        outputPath: 'C:\\Imports\\source.docx',
        format: 'docx',
      }),
  ])('rejects invalid paths and executable injection attempts', (operation) => {
    expect(operation).toThrow(PandocError);
  });

  it('rejects non-allowlisted formats and multiline metadata at runtime', () => {
    expect(() =>
      buildPandocExportArguments({
        inputPath: 'C:\\Documents\\draft.md',
        outputPath: 'C:\\Exports\\draft.docx',
        format: 'pdf' as PandocExportFormat,
      }),
    ).toThrowError(expectPandocError('INVALID_FORMAT'));
    expect(() =>
      buildPandocExportArguments({
        inputPath: 'C:\\Documents\\draft.md',
        outputPath: 'C:\\Exports\\draft.docx',
        format: 'docx',
        options: { metadata: { title: 'first line\n--filter=evil' } },
      }),
    ).toThrowError(expectPandocError('INVALID_FORMAT'));
  });

  it('allows Windows extended-length drive and UNC paths but not device namespaces', () => {
    expect(validateAbsolutePath('\\\\?\\C:\\very\\long\\document.md')).toBe(
      '\\\\?\\C:\\very\\long\\document.md',
    );
    expect(validateAbsolutePath('\\\\?\\UNC\\server\\share\\document.md')).toBe(
      '\\\\?\\UNC\\server\\share\\document.md',
    );
  });
});

describe('Pandoc discovery and version validation', () => {
  it('orders manual, PATH, and common candidates and removes Windows duplicates', () => {
    const candidates = listPandocCandidates({
      manualExecutable: 'C:\\Selected\\pandoc.exe',
      platform: 'win32',
      env: {
        PATH: '"C:\\Tools";C:\\Program Files\\Pandoc',
        ProgramFiles: 'C:\\Program Files',
        LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local',
        USERPROFILE: 'C:\\Users\\test',
      },
    });

    expect(candidates.slice(0, 3)).toEqual([
      { executable: 'C:\\Selected\\pandoc.exe', source: 'manual' },
      { executable: 'C:\\Tools\\pandoc.exe', source: 'path' },
      { executable: 'C:\\Program Files\\Pandoc\\pandoc.exe', source: 'path' },
    ]);
    expect(
      candidates.filter(
        ({ executable }) => executable.toLowerCase() === 'c:\\program files\\pandoc\\pandoc.exe',
      ),
    ).toHaveLength(1);
    expect(candidates).toContainEqual({
      executable: 'C:\\Users\\test\\scoop\\apps\\pandoc\\current\\pandoc.exe',
      source: 'common',
    });
  });

  it.each([
    ['pandoc 3.6.4\nFeatures: +server', '3.6.4'],
    ['pandoc.exe 2.19.2\r\nCompiled with pandoc-types', '2.19.2'],
    ['pandoc 3.1.11.1', '3.1.11.1'],
  ])('parses a genuine version line', (output, expected) => {
    expect(parsePandocVersion(output)).toBe(expected);
  });

  it('rejects an executable that does not identify itself as Pandoc', () => {
    expect(() => parsePandocVersion('not-pandoc 1.0')).toThrowError(expectPandocError('NOT_PANDOC'));
  });

  it('probes the selected executable with an exact --version argv and no shell', async () => {
    const harness = spawnHarness([{ stdout: 'pandoc 3.6.4\n' }]);
    const installation = await probePandoc(
      { executable: 'C:\\Tools\\pandoc.exe', source: 'manual' },
      {},
      dependencies(harness.spawn),
    );

    expect(installation).toMatchObject({ version: '3.6.4', source: 'manual' });
    expect(harness.calls).toEqual([
      {
        executable: 'C:\\Tools\\pandoc.exe',
        args: ['--version'],
        options: { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
      },
    ]);
  });

  it('finds a working PATH candidate after inaccessible candidates', async () => {
    const harness = spawnHarness([{ stdout: 'pandoc 3.5\n' }]);
    const result = await detectPandoc(
      { platform: 'win32', env: { PATH: 'C:\\Missing;C:\\Working' } },
      dependencies(harness.spawn, {
        stat: async (filePath) => {
          if (!filePath.toLowerCase().includes('working')) throw new Error('ENOENT');
          return { isFile: () => true, isDirectory: () => false };
        },
      }),
    );

    expect(result).toMatchObject({
      available: true,
      status: 'available',
      installation: { executable: 'C:\\Working\\pandoc.exe', version: '3.5' },
    });
    expect(result.attempts[0]).toMatchObject({
      executable: 'C:\\Missing\\pandoc.exe',
      errorCode: 'NOT_FOUND',
    });
  });

  it('returns an actionable missing status instead of throwing', async () => {
    const harness = spawnHarness([]);
    const result = await detectPandoc(
      { platform: 'win32', env: {} },
      dependencies(harness.spawn, { stat: () => Promise.reject(new Error('ENOENT')) }),
    );

    expect(result.available).toBe(false);
    expect(result.status).toBe('missing');
    expect(result.message).toMatch(/Install Pandoc|select pandoc\.exe/i);
    expect(harness.calls).toHaveLength(0);
  });
});

describe('safe Pandoc execution', () => {
  it('runs a successful conversion with exact argv, progress, and captured output', async () => {
    const harness = spawnHarness([
      { stdout: 'pandoc 3.6.4\n' },
      { stdout: 'conversion output\n', stderr: 'warning\n' },
    ]);
    const stages: string[] = [];
    const result = await runPandocConversion(
      'C:\\Tools\\pandoc.exe',
      {
        direction: 'export',
        format: 'docx',
        inputPath: 'C:\\Documents\\draft & whoami.md',
        outputPath: 'C:\\Exports\\draft & calc.docx',
      },
      { onProgress: ({ stage }) => stages.push(stage) },
      dependencies(harness.spawn),
    );

    expect(result).toMatchObject({
      pandocVersion: '3.6.4',
      direction: 'export',
      format: 'docx',
      exitCode: 0,
      stdout: 'conversion output\n',
      stderr: 'warning\n',
    });
    expect(harness.calls).toHaveLength(2);
    expect(harness.calls[1].options.shell).toBe(false);
    expect(harness.calls[1].args.at(-1)).toBe('C:\\Documents\\draft & whoami.md');
    expect(harness.calls[1].args).toContain('C:\\Exports\\draft & calc.docx');
    expect(stages).toEqual(expect.arrayContaining(['validating', 'probing', 'converting', 'completed']));
  });

  it('caps stdout and stderr capture while reporting original byte counts', async () => {
    const harness = spawnHarness([
      { stdout: 'pandoc 3.6.4\n' },
      { stdout: '1234567890', stderr: 'abcdefghij' },
    ]);
    const result = await runPandocConversion(
      'C:\\Tools\\pandoc.exe',
      {
        direction: 'export',
        format: 'plain',
        inputPath: 'C:\\Documents\\draft.md',
        outputPath: 'C:\\Exports\\draft.txt',
      },
      { maxOutputBytes: 5 },
      dependencies(harness.spawn),
    );

    expect(result).toMatchObject({
      stdout: '12345',
      stderr: 'abcde',
      stdoutBytes: 10,
      stderrBytes: 10,
      stdoutTruncated: true,
      stderrTruncated: true,
    });
  });

  it('returns stderr and exit details for a failed conversion', async () => {
    const harness = spawnHarness([
      { stdout: 'pandoc 3.6.4\n' },
      { stderr: 'Unknown writer: unsafe\n', exitCode: 7 },
    ]);
    const promise = runPandocConversion(
      'C:\\Tools\\pandoc.exe',
      {
        direction: 'export',
        format: 'docx',
        inputPath: 'C:\\Documents\\draft.md',
        outputPath: 'C:\\Exports\\draft.docx',
      },
      {},
      dependencies(harness.spawn),
    );

    await expect(promise).rejects.toMatchObject({
      code: 'PROCESS_FAILED',
      message: 'Unknown writer: unsafe',
      details: { exitCode: 7, stderr: 'Unknown writer: unsafe\n' },
    });
  });

  it('cancels a running conversion and terminates the child process', async () => {
    const harness = spawnHarness([{ stdout: 'pandoc 3.6.4\n' }, { hang: true }]);
    const controller = new AbortController();
    const promise = runPandocConversion(
      'C:\\Tools\\pandoc.exe',
      {
        direction: 'import',
        format: 'docx',
        inputPath: 'C:\\Imports\\source.docx',
        outputPath: 'C:\\Documents\\source.md',
      },
      {
        signal: controller.signal,
        onProgress: ({ stage }) => {
          if (stage === 'converting') queueMicrotask(() => controller.abort());
        },
      },
      dependencies(harness.spawn),
    );

    await expect(promise).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(harness.children[1].kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('times out a hung conversion and terminates the child process', async () => {
    const harness = spawnHarness([{ stdout: 'pandoc 3.6.4\n' }, { hang: true }]);
    const promise = runPandocConversion(
      'C:\\Tools\\pandoc.exe',
      {
        direction: 'export',
        format: 'odt',
        inputPath: 'C:\\Documents\\draft.md',
        outputPath: 'C:\\Exports\\draft.odt',
      },
      { timeoutMs: 20 },
      dependencies(harness.spawn),
    );

    await expect(promise).rejects.toMatchObject({ code: 'TIMEOUT' });
    expect(harness.children[1].kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('reports a successful process that failed to create its output', async () => {
    const harness = spawnHarness([{ stdout: 'pandoc 3.6.4\n' }, {}]);
    const output = 'C:\\Exports\\draft.rtf';
    const promise = runPandocConversion(
      'C:\\Tools\\pandoc.exe',
      {
        direction: 'export',
        format: 'rtf',
        inputPath: 'C:\\Documents\\draft.md',
        outputPath: output,
      },
      {},
      dependencies(harness.spawn, {
        stat: async (filePath) => {
          if (filePath === output) throw new Error('ENOENT');
          return fakeStat(filePath);
        },
      }),
    );

    await expect(promise).rejects.toMatchObject({
      code: 'OUTPUT_MISSING',
      details: { path: output },
    });
  });
});
