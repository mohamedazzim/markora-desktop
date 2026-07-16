import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

export const PANDOC_EXPORT_FORMATS = ['docx', 'odt', 'rtf', 'epub', 'latex', 'mediawiki', 'plain'] as const;

export const PANDOC_IMPORT_FORMATS = ['docx', 'odt', 'rtf', 'html', 'latex'] as const;

type ProcessPlatform = typeof process.platform;
type ProcessEnvironment = Readonly<typeof process.env>;
type ProcessSignal = Exclude<Parameters<ChildProcess['kill']>[0], number | undefined>;

export type PandocExportFormat = (typeof PANDOC_EXPORT_FORMATS)[number];
export type PandocImportFormat = (typeof PANDOC_IMPORT_FORMATS)[number];
export type PandocCandidateSource = 'manual' | 'path' | 'common';
export type PandocErrorCode =
  | 'INVALID_EXECUTABLE'
  | 'INVALID_PATH'
  | 'INVALID_FORMAT'
  | 'NOT_FOUND'
  | 'NOT_PANDOC'
  | 'SPAWN_FAILED'
  | 'PROCESS_FAILED'
  | 'CANCELLED'
  | 'TIMEOUT'
  | 'OUTPUT_MISSING';

export interface PandocCandidate {
  readonly executable: string;
  readonly source: PandocCandidateSource;
}

export interface PandocInstallation extends PandocCandidate {
  readonly version: string;
  readonly versionOutput: string;
}

export interface PandocDetectionAttempt extends PandocCandidate {
  readonly errorCode: PandocErrorCode;
  readonly message: string;
}

export interface PandocDetectionResult {
  readonly available: boolean;
  readonly status: 'available' | 'missing' | 'invalid-manual';
  readonly installation: PandocInstallation | null;
  readonly candidates: readonly PandocCandidate[];
  readonly attempts: readonly PandocDetectionAttempt[];
  readonly message: string;
}

export interface PandocExportOptions {
  readonly standalone?: boolean;
  readonly tableOfContents?: boolean;
  readonly numberSections?: boolean;
  readonly resourcePath?: string;
  readonly referenceDocument?: string;
  readonly metadata?: Readonly<Partial<Record<'title' | 'author' | 'date', string>>>;
}

export interface PandocImportOptions {
  readonly standalone?: boolean;
  readonly extractMediaDirectory?: string;
}

export interface PandocExportRequest {
  readonly inputPath: string;
  readonly outputPath: string;
  readonly format: PandocExportFormat;
  readonly options?: PandocExportOptions;
}

export interface PandocImportRequest {
  readonly inputPath: string;
  readonly outputPath: string;
  readonly format: PandocImportFormat;
  readonly options?: PandocImportOptions;
}

export type PandocConversionRequest =
  | ({ readonly direction: 'export' } & PandocExportRequest)
  | ({ readonly direction: 'import' } & PandocImportRequest);

export interface PandocProgress {
  readonly stage: 'validating' | 'probing' | 'converting' | 'completed';
  readonly message: string;
  readonly stdoutBytes: number;
  readonly stderrBytes: number;
}

export interface PandocRunOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
  readonly onProgress?: (progress: PandocProgress) => void;
}

export interface PandocProcessResult {
  readonly executable: string;
  readonly args: readonly string[];
  readonly exitCode: number;
  readonly signal: ProcessSignal | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly stdoutBytes: number;
  readonly stderrBytes: number;
  readonly stdoutTruncated: boolean;
  readonly stderrTruncated: boolean;
  readonly durationMs: number;
}

export interface PandocConversionResult extends PandocProcessResult {
  readonly direction: 'export' | 'import';
  readonly format: PandocExportFormat | PandocImportFormat;
  readonly inputPath: string;
  readonly outputPath: string;
  readonly pandocVersion: string;
}

export interface PandocErrorDetails {
  readonly executable?: string;
  readonly args?: readonly string[];
  readonly exitCode?: number | null;
  readonly signal?: ProcessSignal | null;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly stdoutTruncated?: boolean;
  readonly stderrTruncated?: boolean;
  readonly path?: string;
  readonly cause?: unknown;
}

export class PandocError extends Error {
  readonly code: PandocErrorCode;
  readonly details: PandocErrorDetails;

  constructor(code: PandocErrorCode, message: string, details: PandocErrorDetails = {}) {
    super(message);
    this.name = 'PandocError';
    this.code = code;
    this.details = details;
  }
}

export interface PandocChildProcess {
  readonly stdout: { on(event: 'data', listener: (chunk: Buffer | string) => void): unknown } | null;
  readonly stderr: { on(event: 'data', listener: (chunk: Buffer | string) => void): unknown } | null;
  once(event: 'error', listener: (error: Error) => void): unknown;
  once(event: 'close', listener: (exitCode: number | null, signal: ProcessSignal | null) => void): unknown;
  kill(signal?: ProcessSignal): boolean;
}

export interface PandocSpawnOptions {
  readonly shell: false;
  readonly windowsHide: true;
  readonly stdio: ['ignore', 'pipe', 'pipe'];
}

export type PandocSpawn = (
  executable: string,
  args: readonly string[],
  options: PandocSpawnOptions,
) => PandocChildProcess;

export interface PandocFileStat {
  isFile(): boolean;
  isDirectory(): boolean;
}

export interface PandocDependencies {
  readonly spawn: PandocSpawn;
  readonly stat: (filePath: string) => Promise<PandocFileStat>;
  readonly access: (filePath: string, mode?: number) => Promise<void>;
  readonly env: ProcessEnvironment;
  readonly platform: ProcessPlatform;
}

const defaultDependencies: PandocDependencies = {
  spawn: (executable, args, options) =>
    nodeSpawn(executable, [...args], options) as unknown as PandocChildProcess,
  stat: (filePath) => fs.stat(filePath),
  access: (filePath, mode) => fs.access(filePath, mode),
  env: process.env,
  platform: process.platform,
};

const EXPORT_FORMATS: Record<
  PandocExportFormat,
  { readonly pandocName: string; readonly extensions: readonly string[] }
> = {
  docx: { pandocName: 'docx', extensions: ['.docx'] },
  odt: { pandocName: 'odt', extensions: ['.odt'] },
  rtf: { pandocName: 'rtf', extensions: ['.rtf'] },
  epub: { pandocName: 'epub', extensions: ['.epub'] },
  latex: { pandocName: 'latex', extensions: ['.tex', '.latex'] },
  mediawiki: { pandocName: 'mediawiki', extensions: ['.mediawiki', '.wiki'] },
  plain: { pandocName: 'plain', extensions: ['.txt'] },
};

const IMPORT_FORMATS: Record<
  PandocImportFormat,
  { readonly pandocName: string; readonly extensions: readonly string[] }
> = {
  docx: { pandocName: 'docx', extensions: ['.docx'] },
  odt: { pandocName: 'odt', extensions: ['.odt'] },
  rtf: { pandocName: 'rtf', extensions: ['.rtf'] },
  html: { pandocName: 'html', extensions: ['.html', '.htm'] },
  latex: { pandocName: 'latex', extensions: ['.tex', '.latex'] },
};

const MARKDOWN_EXTENSIONS = ['.md', '.markdown'] as const;
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_OUTPUT_LIMIT = 1_048_576;
const MAX_TIMEOUT_MS = 30 * 60_000;
const MAX_CAPTURE_LIMIT = 16 * 1_048_576;

function mergeDependencies(overrides: Partial<PandocDependencies> = {}): PandocDependencies {
  return { ...defaultDependencies, ...overrides };
}

function isWindowsAbsolute(input: string): boolean {
  return path.win32.isAbsolute(input);
}

function isPosixAbsolute(input: string): boolean {
  return path.posix.isAbsolute(input);
}

function isUnsafeWindowsDevicePath(input: string): boolean {
  if (/^\\\\\.\\/i.test(input)) return true;
  if (!/^\\\\\?\\/i.test(input)) return false;
  return !/^\\\\\?\\(?:[a-z]:\\|UNC\\[^\\]+\\[^\\]+)/i.test(input);
}

export function validateAbsolutePath(input: string, label = 'Path'): string {
  if (typeof input !== 'string' || input.length === 0 || input.length > 32_767) {
    throw new PandocError('INVALID_PATH', `${label} must be a non-empty absolute path.`, {
      path: typeof input === 'string' ? input : undefined,
    });
  }
  if ([...input].some((character) => character.charCodeAt(0) <= 31)) {
    throw new PandocError('INVALID_PATH', `${label} contains control characters.`, { path: input });
  }
  if ((!isWindowsAbsolute(input) && !isPosixAbsolute(input)) || isUnsafeWindowsDevicePath(input)) {
    throw new PandocError('INVALID_PATH', `${label} must be an absolute filesystem path.`, {
      path: input,
    });
  }
  return isWindowsAbsolute(input) ? path.win32.normalize(input) : path.posix.normalize(input);
}

export function validatePandocExecutablePath(
  executable: string,
  platform: ProcessPlatform = process.platform,
): string {
  const validated = validateAbsolutePath(executable, 'Pandoc executable');
  if (platform === 'win32' && path.win32.extname(validated).toLowerCase() !== '.exe') {
    throw new PandocError(
      'INVALID_EXECUTABLE',
      'On Windows, select the pandoc.exe executable (batch and command files are not accepted).',
      { path: validated },
    );
  }
  return validated;
}

function assertExtension(filePath: string, allowed: readonly string[], label: string): void {
  const extension = (isWindowsAbsolute(filePath) ? path.win32 : path.posix).extname(filePath).toLowerCase();
  if (!allowed.includes(extension)) {
    throw new PandocError(
      'INVALID_PATH',
      `${label} must use one of these extensions: ${allowed.join(', ')}.`,
      { path: filePath },
    );
  }
}

function assertDifferentPaths(inputPath: string, outputPath: string): void {
  const windowsPaths = isWindowsAbsolute(inputPath) || isWindowsAbsolute(outputPath);
  const left = windowsPaths ? inputPath.toLocaleLowerCase('en-US') : inputPath;
  const right = windowsPaths ? outputPath.toLocaleLowerCase('en-US') : outputPath;
  if (left === right) {
    throw new PandocError('INVALID_PATH', 'Input and output paths must be different.', {
      path: outputPath,
    });
  }
}

function validateMetadata(value: string, field: string): string {
  if (
    typeof value !== 'string' ||
    value.length > 2_000 ||
    [...value].some((character) => ['\0', '\r', '\n'].includes(character))
  ) {
    throw new PandocError(
      'INVALID_FORMAT',
      `Pandoc metadata field ${field} must be a single line no longer than 2,000 characters.`,
    );
  }
  return value;
}

function getExportFormat(format: PandocExportFormat) {
  const specification = EXPORT_FORMATS[format];
  if (!specification) {
    throw new PandocError('INVALID_FORMAT', `Unsupported Pandoc export format: ${String(format)}.`);
  }
  return specification;
}

function getImportFormat(format: PandocImportFormat) {
  const specification = IMPORT_FORMATS[format];
  if (!specification) {
    throw new PandocError('INVALID_FORMAT', `Unsupported Pandoc import format: ${String(format)}.`);
  }
  return specification;
}

export function buildPandocExportArguments(request: PandocExportRequest): readonly string[] {
  const specification = getExportFormat(request.format);
  const inputPath = validateAbsolutePath(request.inputPath, 'Pandoc input');
  const outputPath = validateAbsolutePath(request.outputPath, 'Pandoc output');
  assertExtension(inputPath, MARKDOWN_EXTENSIONS, 'Pandoc export input');
  assertExtension(outputPath, specification.extensions, 'Pandoc export output');
  assertDifferentPaths(inputPath, outputPath);

  const args: string[] = ['--from', 'gfm', '--to', specification.pandocName, '--output', outputPath];
  const options = request.options;
  if (options?.standalone !== false) args.push('--standalone');
  if (options?.tableOfContents) args.push('--toc');
  if (options?.numberSections) args.push('--number-sections');
  if (options?.resourcePath) {
    args.push('--resource-path', validateAbsolutePath(options.resourcePath, 'Pandoc resource path'));
  }
  if (options?.referenceDocument) {
    args.push(
      '--reference-doc',
      validateAbsolutePath(options.referenceDocument, 'Pandoc reference document'),
    );
  }
  if (options?.metadata) {
    for (const field of ['title', 'author', 'date'] as const) {
      const value = options.metadata[field];
      if (value !== undefined) args.push('--metadata', `${field}=${validateMetadata(value, field)}`);
    }
  }
  args.push('--', inputPath);
  return Object.freeze(args);
}

export function buildPandocImportArguments(request: PandocImportRequest): readonly string[] {
  const specification = getImportFormat(request.format);
  const inputPath = validateAbsolutePath(request.inputPath, 'Pandoc input');
  const outputPath = validateAbsolutePath(request.outputPath, 'Pandoc output');
  assertExtension(inputPath, specification.extensions, 'Pandoc import input');
  assertExtension(outputPath, MARKDOWN_EXTENSIONS, 'Pandoc import output');
  assertDifferentPaths(inputPath, outputPath);

  const args: string[] = [
    '--from',
    specification.pandocName,
    '--to',
    'gfm',
    '--wrap',
    'none',
    '--output',
    outputPath,
  ];
  if (request.options?.standalone) args.push('--standalone');
  if (request.options?.extractMediaDirectory) {
    args.push(
      '--extract-media',
      validateAbsolutePath(request.options.extractMediaDirectory, 'Pandoc media directory'),
    );
  }
  args.push('--', inputPath);
  return Object.freeze(args);
}

function trimPathEntry(entry: string): string {
  return entry.trim().replace(/^"|"$/g, '');
}

export function listPandocCandidates(
  options: {
    readonly manualExecutable?: string;
    readonly env?: ProcessEnvironment;
    readonly platform?: ProcessPlatform;
  } = {},
): readonly PandocCandidate[] {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const executableName = platform === 'win32' ? 'pandoc.exe' : 'pandoc';
  const candidates: PandocCandidate[] = [];

  if (options.manualExecutable) {
    candidates.push({
      executable: validatePandocExecutablePath(options.manualExecutable, platform),
      source: 'manual',
    });
  }

  const delimiter = platform === 'win32' ? ';' : ':';
  for (const entry of (env.PATH ?? env.Path ?? '').split(delimiter).map(trimPathEntry)) {
    if (!entry) continue;
    const candidate =
      platform === 'win32' ? path.win32.join(entry, executableName) : path.join(entry, executableName);
    if (isWindowsAbsolute(candidate) || isPosixAbsolute(candidate)) {
      candidates.push({ executable: candidate, source: 'path' });
    }
  }

  if (platform === 'win32') {
    const common = [
      env.ProgramFiles && path.win32.join(env.ProgramFiles, 'Pandoc', executableName),
      env['ProgramFiles(x86)'] && path.win32.join(env['ProgramFiles(x86)'], 'Pandoc', executableName),
      env.LOCALAPPDATA && path.win32.join(env.LOCALAPPDATA, 'Pandoc', executableName),
      env.LOCALAPPDATA && path.win32.join(env.LOCALAPPDATA, 'Programs', 'Pandoc', executableName),
      env.ProgramData && path.win32.join(env.ProgramData, 'chocolatey', 'bin', executableName),
      env.ChocolateyInstall && path.win32.join(env.ChocolateyInstall, 'bin', executableName),
      env.USERPROFILE &&
        path.win32.join(env.USERPROFILE, 'scoop', 'apps', 'pandoc', 'current', executableName),
    ].filter((candidate): candidate is string => Boolean(candidate));
    common.forEach((executable) => candidates.push({ executable, source: 'common' }));
  } else {
    ['/usr/local/bin/pandoc', '/usr/bin/pandoc', '/opt/homebrew/bin/pandoc'].forEach((executable) =>
      candidates.push({ executable, source: 'common' }),
    );
  }

  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = platform === 'win32' ? candidate.executable.toLocaleLowerCase('en-US') : candidate.executable;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function emitProgress(callback: PandocRunOptions['onProgress'], progress: PandocProgress): void {
  try {
    callback?.(progress);
  } catch {
    // A renderer callback must not be able to corrupt process cleanup.
  }
}

function readPositiveInteger(
  value: number | undefined,
  fallback: number,
  maximum: number,
  label: string,
): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 1 || result > maximum) {
    throw new PandocError(
      'INVALID_FORMAT',
      `${label} must be a positive integer no greater than ${maximum}.`,
    );
  }
  return result;
}

interface OutputCollector {
  append(chunk: Buffer | string): void;
  result(): { readonly text: string; readonly bytes: number; readonly truncated: boolean };
}

function createOutputCollector(limit: number): OutputCollector {
  const chunks: Buffer[] = [];
  let captured = 0;
  let total = 0;
  return {
    append(chunk) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.length;
      const remaining = limit - captured;
      if (remaining > 0) {
        const portion = buffer.subarray(0, remaining);
        chunks.push(portion);
        captured += portion.length;
      }
    },
    result() {
      return {
        text: Buffer.concat(chunks).toString('utf8'),
        bytes: total,
        truncated: total > captured,
      };
    },
  };
}

async function runPandocProcess(
  executable: string,
  args: readonly string[],
  stage: 'probing' | 'converting',
  options: PandocRunOptions,
  dependencies: PandocDependencies,
): Promise<PandocProcessResult> {
  const timeoutMs = readPositiveInteger(
    options.timeoutMs,
    DEFAULT_TIMEOUT_MS,
    MAX_TIMEOUT_MS,
    'Pandoc timeout',
  );
  const outputLimit = readPositiveInteger(
    options.maxOutputBytes,
    DEFAULT_OUTPUT_LIMIT,
    MAX_CAPTURE_LIMIT,
    'Pandoc output capture limit',
  );
  if (options.signal?.aborted) {
    throw new PandocError('CANCELLED', 'Pandoc conversion was cancelled before it started.', {
      executable,
      args,
    });
  }

  return new Promise<PandocProcessResult>((resolve, reject) => {
    const startedAt = Date.now();
    const stdout = createOutputCollector(outputLimit);
    const stderr = createOutputCollector(outputLimit);
    let child: PandocChildProcess;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener('abort', cancel);
    };
    const fail = (error: PandocError, kill = false) => {
      if (settled) return;
      settled = true;
      if (kill) {
        try {
          child.kill('SIGTERM');
        } catch {
          // The process may already have exited between the event and cleanup.
        }
      }
      cleanup();
      reject(error);
    };
    const cancel = () =>
      fail(
        new PandocError('CANCELLED', 'Pandoc conversion was cancelled.', {
          executable,
          args,
        }),
        true,
      );

    try {
      child = dependencies.spawn(executable, args, {
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (cause) {
      fail(
        new PandocError('SPAWN_FAILED', 'Pandoc could not be started.', {
          executable,
          args,
          cause,
        }),
      );
      return;
    }

    options.signal?.addEventListener('abort', cancel, { once: true });
    timer = setTimeout(() => {
      const capturedOut = stdout.result();
      const capturedError = stderr.result();
      fail(
        new PandocError('TIMEOUT', `Pandoc did not finish within ${timeoutMs} ms.`, {
          executable,
          args,
          stdout: capturedOut.text,
          stderr: capturedError.text,
          stdoutTruncated: capturedOut.truncated,
          stderrTruncated: capturedError.truncated,
        }),
        true,
      );
    }, timeoutMs);

    emitProgress(options.onProgress, {
      stage,
      message: stage === 'probing' ? 'Checking Pandoc version…' : 'Pandoc conversion is running…',
      stdoutBytes: 0,
      stderrBytes: 0,
    });
    child.stdout?.on('data', (chunk) => {
      stdout.append(chunk);
      emitProgress(options.onProgress, {
        stage,
        message: stage === 'probing' ? 'Checking Pandoc version…' : 'Pandoc conversion is running…',
        stdoutBytes: stdout.result().bytes,
        stderrBytes: stderr.result().bytes,
      });
    });
    child.stderr?.on('data', (chunk) => {
      stderr.append(chunk);
      emitProgress(options.onProgress, {
        stage,
        message: stage === 'probing' ? 'Checking Pandoc version…' : 'Pandoc conversion is running…',
        stdoutBytes: stdout.result().bytes,
        stderrBytes: stderr.result().bytes,
      });
    });
    child.once('error', (cause) => {
      const code = (cause as Error & { code?: string }).code === 'ENOENT' ? 'NOT_FOUND' : 'SPAWN_FAILED';
      fail(
        new PandocError(
          code,
          code === 'NOT_FOUND' ? 'Pandoc executable was not found.' : 'Pandoc failed to start.',
          {
            executable,
            args,
            cause,
          },
        ),
      );
    });
    child.once('close', (exitCode, signal) => {
      if (settled) return;
      settled = true;
      cleanup();
      const capturedOut = stdout.result();
      const capturedError = stderr.result();
      const result: PandocProcessResult = {
        executable,
        args: Object.freeze([...args]),
        exitCode: exitCode ?? -1,
        signal,
        stdout: capturedOut.text,
        stderr: capturedError.text,
        stdoutBytes: capturedOut.bytes,
        stderrBytes: capturedError.bytes,
        stdoutTruncated: capturedOut.truncated,
        stderrTruncated: capturedError.truncated,
        durationMs: Date.now() - startedAt,
      };
      if (exitCode !== 0) {
        reject(
          new PandocError(
            'PROCESS_FAILED',
            capturedError.text.trim() || `Pandoc exited with code ${String(exitCode)}.`,
            {
              executable,
              args,
              exitCode,
              signal,
              stdout: capturedOut.text,
              stderr: capturedError.text,
              stdoutTruncated: capturedOut.truncated,
              stderrTruncated: capturedError.truncated,
            },
          ),
        );
        return;
      }
      resolve(result);
    });
  });
}

async function validateExecutableFile(executable: string, dependencies: PandocDependencies): Promise<string> {
  const validated = validatePandocExecutablePath(executable, dependencies.platform);
  try {
    const stat = await dependencies.stat(validated);
    if (!stat.isFile()) throw new Error('The selected path is not a file.');
    await dependencies.access(
      validated,
      dependencies.platform === 'win32' ? fsConstants.F_OK : fsConstants.X_OK,
    );
    return validated;
  } catch (cause) {
    throw new PandocError('NOT_FOUND', 'The selected Pandoc executable is missing or inaccessible.', {
      path: validated,
      cause,
    });
  }
}

export function parsePandocVersion(output: string): string {
  const firstLine = output.split(/\r?\n/u, 1)[0]?.trim() ?? '';
  const match = /^pandoc(?:\.exe)?\s+v?(\d+(?:\.\d+){0,4}(?:[-+][0-9a-z.-]+)?)/iu.exec(firstLine);
  if (!match) {
    throw new PandocError('NOT_PANDOC', 'The selected executable did not identify itself as Pandoc.', {
      stdout: output,
    });
  }
  return match[1];
}

export async function probePandoc(
  candidate: PandocCandidate,
  options: PandocRunOptions = {},
  dependencyOverrides: Partial<PandocDependencies> = {},
): Promise<PandocInstallation> {
  const dependencies = mergeDependencies(dependencyOverrides);
  const executable = await validateExecutableFile(candidate.executable, dependencies);
  // A very small conversion-output cap must not truncate the version token used
  // to authenticate the selected executable as Pandoc.
  const probeOptions: PandocRunOptions = {
    ...options,
    maxOutputBytes: Math.max(options.maxOutputBytes ?? 0, 4_096),
  };
  const result = await runPandocProcess(executable, ['--version'], 'probing', probeOptions, dependencies);
  const versionOutput = result.stdout.trim();
  return {
    executable,
    source: candidate.source,
    version: parsePandocVersion(versionOutput),
    versionOutput,
  };
}

export async function detectPandoc(
  options: PandocRunOptions & {
    readonly manualExecutable?: string;
    readonly env?: ProcessEnvironment;
    readonly platform?: ProcessPlatform;
  } = {},
  dependencyOverrides: Partial<PandocDependencies> = {},
): Promise<PandocDetectionResult> {
  const dependencies = mergeDependencies({
    ...dependencyOverrides,
    ...(options.env ? { env: options.env } : {}),
    ...(options.platform ? { platform: options.platform } : {}),
  });
  let candidates: readonly PandocCandidate[];
  let invalidManual: PandocError | undefined;
  try {
    candidates = listPandocCandidates({
      manualExecutable: options.manualExecutable,
      env: dependencies.env,
      platform: dependencies.platform,
    });
  } catch (error) {
    invalidManual =
      error instanceof PandocError
        ? error
        : new PandocError('INVALID_EXECUTABLE', 'The manually selected Pandoc path is invalid.');
    candidates = listPandocCandidates({ env: dependencies.env, platform: dependencies.platform });
  }

  const attempts: PandocDetectionAttempt[] = invalidManual
    ? [
        {
          executable: options.manualExecutable ?? '',
          source: 'manual',
          errorCode: invalidManual.code,
          message: invalidManual.message,
        },
      ]
    : [];
  for (const candidate of candidates) {
    try {
      const installation = await probePandoc(candidate, options, dependencies);
      return {
        available: true,
        status: 'available',
        installation,
        candidates,
        attempts,
        message: `Pandoc ${installation.version} is available.`,
      };
    } catch (error) {
      const failure =
        error instanceof PandocError
          ? error
          : new PandocError('SPAWN_FAILED', 'Pandoc detection failed unexpectedly.', {
              cause: error,
            });
      attempts.push({
        ...candidate,
        errorCode: failure.code,
        message: failure.message,
      });
    }
  }

  return {
    available: false,
    status: invalidManual ? 'invalid-manual' : 'missing',
    installation: null,
    candidates,
    attempts,
    message: invalidManual
      ? 'The selected Pandoc executable is invalid, and Pandoc was not found automatically.'
      : 'Pandoc was not found. Install Pandoc or select pandoc.exe manually.',
  };
}

async function validateConversionPaths(
  inputPath: string,
  outputPath: string,
  dependencies: PandocDependencies,
): Promise<void> {
  try {
    const inputStat = await dependencies.stat(inputPath);
    if (!inputStat.isFile()) throw new Error('Input is not a file.');
    await dependencies.access(inputPath, fsConstants.R_OK);
  } catch (cause) {
    throw new PandocError('INVALID_PATH', 'Pandoc input does not exist or is not readable.', {
      path: inputPath,
      cause,
    });
  }
  const pathImplementation = isWindowsAbsolute(outputPath) ? path.win32 : path.posix;
  const parent = pathImplementation.dirname(outputPath);
  try {
    const parentStat = await dependencies.stat(parent);
    if (!parentStat.isDirectory()) throw new Error('Output parent is not a directory.');
    await dependencies.access(parent, fsConstants.W_OK);
  } catch (cause) {
    throw new PandocError('INVALID_PATH', 'Pandoc output directory does not exist or is not writable.', {
      path: parent,
      cause,
    });
  }
}

export async function runPandocConversion(
  executable: string,
  request: PandocConversionRequest,
  options: PandocRunOptions = {},
  dependencyOverrides: Partial<PandocDependencies> = {},
): Promise<PandocConversionResult> {
  const dependencies = mergeDependencies(dependencyOverrides);
  emitProgress(options.onProgress, {
    stage: 'validating',
    message: 'Validating Pandoc and conversion paths…',
    stdoutBytes: 0,
    stderrBytes: 0,
  });
  const args =
    request.direction === 'export'
      ? buildPandocExportArguments(request)
      : buildPandocImportArguments(request);
  await validateConversionPaths(request.inputPath, request.outputPath, dependencies);
  const installation = await probePandoc({ executable, source: 'manual' }, options, dependencies);
  const result = await runPandocProcess(installation.executable, args, 'converting', options, dependencies);
  try {
    const output = await dependencies.stat(request.outputPath);
    if (!output.isFile()) throw new Error('Output is not a file.');
  } catch (cause) {
    throw new PandocError(
      'OUTPUT_MISSING',
      'Pandoc exited successfully but did not create the output file.',
      {
        path: request.outputPath,
        executable: installation.executable,
        args,
        stdout: result.stdout,
        stderr: result.stderr,
        cause,
      },
    );
  }
  emitProgress(options.onProgress, {
    stage: 'completed',
    message: 'Pandoc conversion completed.',
    stdoutBytes: result.stdoutBytes,
    stderrBytes: result.stderrBytes,
  });
  return {
    ...result,
    direction: request.direction,
    format: request.format,
    inputPath: request.inputPath,
    outputPath: request.outputPath,
    pandocVersion: installation.version,
  };
}
